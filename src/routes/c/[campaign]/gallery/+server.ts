// The gallery: what is in it, for the whole table, and for the GM, putting
// a new picture in.
// The pictures themselves are served by ../image/[file].

import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import {
	addToGallery,
	asGalleryKind,
	listGallery,
	nameFromFile,
	newImageFile
} from '#lib/server/gallery.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { getStorage } from '#lib/server/storage.ts';
import { imageSize, shrunk, thumbOf, tilesOf, uploadKey } from '#lib/server/tiles.ts';
import { ActionError } from '#lib/server/world.ts';
import { tileLevels } from '#lib/shared/tiles.ts';
import { LIMITS, TOKEN_IMAGE_SIZE, type GalleryResponse } from '#lib/shared/types.ts';

type Extension = 'png' | 'jpg' | 'gif' | 'webp' | 'avif';

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
	return json({ ok: false, error } satisfies GalleryResponse, { status });
}

// Looking is for everyone at the table. Everything else here is the GM's.
export const GET: RequestHandler = (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	return json({ ok: true, items: listGallery(getDb(), actor) } satisfies GalleryResponse);
};

export const POST: RequestHandler = async (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	if (actor.role !== 'gm') return refuse(403, 'The gallery is the GM’s to look after.');

	if (Number(event.request.headers.get('content-length') ?? 0) > LIMITS.imageBytes + 65536) {
		return refuse(413, `Map images can be up to ${LIMITS.imageBytes / 1024 / 1024} MB.`);
	}
	let form: FormData;
	try {
		form = await event.request.formData();
	} catch {
		return refuse(400, 'Malformed upload.');
	}
	const upload = form.get('file');
	if (!(upload instanceof File)) return refuse(400, 'No image was sent.');

	let kind;
	try {
		kind = asGalleryKind(form.get('kind'));
	} catch {
		return refuse(400, 'Malformed upload.');
	}
	const most = kind === 'map' ? LIMITS.imageBytes : LIMITS.tokenImageBytes;
	if (upload.size > most) {
		const what = kind === 'map' ? 'Map images' : 'Token pictures';
		return refuse(413, `${what} can be up to ${most / 1024 / 1024} MB.`);
	}

	const sent = new Uint8Array(await upload.arrayBuffer());
	const format = sniff(sent);
	if (!format) return refuse(415, 'Use a PNG, JPEG, WebP, GIF or AVIF image.');
	const sentSize = await imageSize(sent);
	if (!sentSize) return refuse(415, "That file doesn't look like an image that can be read.");
	if (Math.max(sentSize.width, sentSize.height) > LIMITS.imageSide) {
		return refuse(413, `Images can be up to ${LIMITS.imageSide} pixels on a side.`);
	}

	// A map image is kept as it came. A token is a small thing on the map,
	// and many of them share the table, so its picture is kept small.
	let picture: { bytes: Uint8Array; width: number; height: number };
	let extension: Extension = format;
	if (kind === 'map') {
		picture = { bytes: sent, ...sentSize };
	} else {
		try {
			picture = await shrunk(sent, TOKEN_IMAGE_SIZE);
			extension = 'webp';
		} catch {
			return refuse(415, "That file doesn't look like an image that can be read.");
		}
	}

	const file = newImageFile(extension);
	const storage = getStorage();
	await storage.put(uploadKey(file), picture.bytes);

	try {
		// A big image is cut into tiles before it can be picked, so that it is
		// ready to be looked at the moment it is laid under a map.
		if (kind === 'map' && tileLevels(picture.width, picture.height) > 0) await tilesOf(file);
		await thumbOf(file);
	} catch (err) {
		await storage.remove(uploadKey(file));
		console.error(`Could not prepare ${file}:`, err);
		return refuse(500, "The image couldn't be prepared. The server's output says why.");
	}

	const db = getDb();
	try {
		addToGallery(db, actor, {
			kind,
			name: nameFromFile(upload.name),
			file,
			width: picture.width,
			height: picture.height
		});
		return json({ ok: true, items: listGallery(db, actor) } satisfies GalleryResponse);
	} catch (err) {
		await storage.remove(uploadKey(file));
		if (err instanceof ActionError) return refuse(400, err.message);
		throw err;
	}
};
