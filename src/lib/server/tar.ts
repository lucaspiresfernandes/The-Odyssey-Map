// Just enough of the tar format to put a campaign in one file and take it
// out again: plain files, one after the other, each behind a 512-byte
// header. Written and read as a stream, so a campaign with big map images
// never has to fit in memory whole. Any archive tool opens what this
// writes.

const BLOCK = 512;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One file to put in an archive: its name, how many bytes it is, and the bytes, in pieces. */
export interface TarFile {
	name: string;
	size: number;
	bytes: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
}

function header(name: string, size: number): Uint8Array {
	const named = encoder.encode(name);
	if (named.length > 100) throw new Error(`"${name}" is too long a name for an archive.`);
	const block = new Uint8Array(BLOCK);
	const put = (text: string, at: number) => block.set(encoder.encode(text), at);
	block.set(named, 0);
	put('0000644\0', 100); // mode
	put('0000000\0', 108); // owner
	put('0000000\0', 116); // group
	put(size.toString(8).padStart(11, '0') + '\0', 124);
	put(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136);
	// The checksum is taken with its own field read as spaces.
	put('        ', 148);
	put('0', 156); // a plain file
	put('ustar\0' + '00', 257);
	let sum = 0;
	for (const byte of block) sum += byte;
	put(sum.toString(8).padStart(6, '0') + '\0 ', 148);
	return block;
}

/** An archive of these files, as a stream of its bytes. */
export function tarStream(files: AsyncIterable<TarFile>): ReadableStream<Uint8Array> {
	async function* pieces() {
		for await (const file of files) {
			yield header(file.name, file.size);
			let written = 0;
			for await (const chunk of file.bytes) {
				written += chunk.length;
				yield chunk;
			}
			if (written !== file.size) throw new Error(`"${file.name}" changed while it was being read.`);
			// Each file is padded out to a whole number of blocks.
			const over = written % BLOCK;
			if (over) yield new Uint8Array(BLOCK - over);
		}
		// Two empty blocks end an archive.
		yield new Uint8Array(BLOCK * 2);
	}
	const source = pieces();
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const { done, value } = await source.next();
			if (done) controller.close();
			else controller.enqueue(value);
		},
		async cancel() {
			await source.return?.();
		}
	});
}

/** Hands out a stream a counted number of bytes at a time. */
class Feed {
	#reader: ReadableStreamDefaultReader<Uint8Array>;
	#chunks: Uint8Array[] = [];
	#have = 0;

	constructor(stream: ReadableStream<Uint8Array>) {
		this.#reader = stream.getReader();
	}

	/** The next `count` bytes, or null when the stream ends before the first of them. */
	async take(count: number): Promise<Uint8Array | null> {
		while (this.#have < count) {
			const { done, value } = await this.#reader.read();
			if (done) {
				if (this.#have === 0) return null;
				throw new TarError('The file ends in the middle of something.');
			}
			if (value.length) {
				this.#chunks.push(value);
				this.#have += value.length;
			}
		}
		const out = new Uint8Array(count);
		let filled = 0;
		while (filled < count) {
			const chunk = this.#chunks[0];
			const part = chunk.subarray(0, count - filled);
			out.set(part, filled);
			filled += part.length;
			if (part.length === chunk.length) this.#chunks.shift();
			else this.#chunks[0] = chunk.subarray(part.length);
		}
		this.#have -= count;
		return out;
	}

	cancel() {
		return this.#reader.cancel().catch(() => {});
	}
}

/** What was read is not an archive this can open. */
export class TarError extends Error {}

/**
 * The files in an archive, one at a time, in the order they were put in.
 * `most` says how many bytes a file of that name may be: a bigger one ends
 * the reading with a `TarError`, before any of it is read.
 */
export async function* tarEntries(
	stream: ReadableStream<Uint8Array>,
	most: (name: string) => number
): AsyncGenerator<{ name: string; bytes: Uint8Array }> {
	const feed = new Feed(stream);
	try {
		for (;;) {
			const block = await feed.take(BLOCK);
			// The end of the stream, or the empty block that ends an archive.
			if (!block || block.every((byte) => byte === 0)) return;
			const text = (from: number, length: number) => {
				const field = block.subarray(from, from + length);
				const end = field.indexOf(0);
				return decoder.decode(end === -1 ? field : field.subarray(0, end));
			};
			if (text(257, 5) !== 'ustar') throw new TarError('This is not an archive.');
			const name = text(0, 100);
			const size = parseInt(text(124, 12).trim() || '0', 8);
			if (!Number.isSafeInteger(size) || size < 0) throw new TarError('This is not an archive.');
			const type = text(156, 1);
			const plain = type === '0' || type === '';
			if (plain && size > most(name)) throw new TarError(`"${name}" is too big.`);
			const padded = Math.ceil(size / BLOCK) * BLOCK;
			if (!plain) {
				// Folders and the like have nothing for us. What they carry is skipped.
				for (let left = padded; left > 0; left -= BLOCK) await feed.take(BLOCK);
				continue;
			}
			const body = size ? await feed.take(padded) : new Uint8Array(0);
			if (!body) throw new TarError('The file ends in the middle of something.');
			yield { name, bytes: body.subarray(0, size) };
		}
	} finally {
		await feed.cancel();
	}
}
