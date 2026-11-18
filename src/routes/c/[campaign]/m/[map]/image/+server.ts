import { json, type RequestHandler } from '@sveltejs/kit';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getDb, uploadsDir } from '#lib/server/db.ts';
import { newId } from '#lib/server/ids.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { toLiveEvent } from '#lib/server/visibility.ts';
import { ActionError, IMAGE_FILE_PATTERN, setMapImage } from '#lib/server/world.ts';
import { canEditWorld } from '#lib/shared/rules.ts';
import { LIMITS } from '#lib/shared/types.ts';

const CONTENT_TYPES = {
	png: 'image/png',
	jpg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif'
} as const;

type Extension = keyof typeof CONTENT_TYPES;

/** Decides the format from the file's own bytes, not from what the upload claims. */
function sniff(bytes: Uint8Array): Extension | null {
	const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
	if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
	if (ascii(0, 4) === 'GIF8') return 'gif';
	if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
	if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'avif';
	return null;
}

function refuse(status: number, error: string) {
	return json({ ok: false, error }, { status });
}

export const GET: RequestHandler = async (event) => {
	const { campaign } = requireMemberApi(event, event.params.campaign!);
	const mapId = event.params.map!;
	const row = getDb()
		.query('SELECT image_file FROM maps WHERE id = ? AND campaign_id = ?')
		.get(mapId, campaign.id) as { image_file: string | null } | null;
	if (!row) return refuse(404, 'Map not found');

	// `v` names one specific upload of this map, so a URL always means the
	// same bytes and can be cached for good. Older uploads stay reachable
	// for the history. Anything else falls back to the current image.
	const wanted = event.url.searchParams.get('v') ?? '';
	const pinned = IMAGE_FILE_PATTERN.test(wanted) && wanted.startsWith(`${mapId}-`);
	const file = pinned ? wanted : row.image_file;
	if (!file) return refuse(404, 'This map has no image');

	const blob = Bun.file(join(uploadsDir(), file));
	if (!(await blob.exists())) return refuse(404, 'Image not found');

	const extension = file.slice(file.lastIndexOf('.') + 1) as Extension;
	return new Response(blob, {
		headers: {
			'content-type': CONTENT_TYPES[extension],
			'cache-control': pinned ? 'private, max-age=31536000, immutable' : 'private, no-cache',
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox"
		}
	});
};

export const POST: RequestHandler = async (event) => {
	const { campaign, actor } = requireMemberApi(event, event.params.campaign!);
	if (!canEditWorld(actor.role)) return refuse(403, 'Only the GM can change maps and regions.');

	const db = getDb();
	const mapId = event.params.map!;
	const exists = db
		.query('SELECT 1 FROM maps WHERE id = ? AND campaign_id = ?')
		.get(mapId, campaign.id);
	if (!exists) return refuse(404, 'Map not found');

	const tooBig = `Map images can be up to ${LIMITS.imageBytes / 1024 / 1024} MB.`;
	if (Number(event.request.headers.get('content-length') ?? 0) > LIMITS.imageBytes + 65536) {
		return refuse(413, tooBig);
	}

	let form: FormData;
	try {
		form = await event.request.formData();
	} catch {
		return refuse(400, 'Malformed upload.');
	}
	const upload = form.get('file');
	if (!(upload instanceof File)) return refuse(400, 'No image was sent.');
	if (upload.size > LIMITS.imageBytes) return refuse(413, tooBig);

	const bytes = new Uint8Array(await upload.arrayBuffer());
	const extension = sniff(bytes);
	if (!extension) return refuse(415, 'Use a PNG, JPEG, WebP, GIF or AVIF image.');

	// The id came out of the database, so it is safe as part of a file name.
	const file = `${mapId}-${newId(12)}.${extension}`;
	const path = join(uploadsDir(), file);
	mkdirSync(uploadsDir(), { recursive: true });
	await Bun.write(path, bytes);

	try {
		const events = setMapImage(db, actor, mapId, {
			file,
			width: Number(form.get('width')),
			height: Number(form.get('height'))
		});
		return json({
			ok: true,
			events: events.map((e) => toLiveEvent(e, actor.role)).filter((e) => e !== null)
		});
	} catch (err) {
		rmSync(path, { force: true });
		if (err instanceof ActionError) return refuse(400, err.message);
		throw err;
	}
};
