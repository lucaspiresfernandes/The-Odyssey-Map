// The gallery: what is in it, for the whole table, and putting a new
// picture in: the GM any picture, a player one for a token of their own.
// The pictures themselves are served by ../image/[file].

import { type RequestHandler } from '@sveltejs/kit';
import { galleryChanged } from '#lib/server/bridge.ts';
import { getDb } from '#lib/server/db.ts';
import {
	addToGallery,
	asGalleryKind,
	listGallery,
	nameFromFile,
	newImageFile,
	requireRoomFor
} from '#lib/server/gallery.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { getStorage } from '#lib/server/storage.ts';
import {
	imageSize,
	shrunk,
	sniffImage,
	thumbOf,
	tilesOf,
	uploadKey,
	type ImageFormat
} from '#lib/server/tiles.ts';
import { ActionError, ERROR_STATUS } from '#lib/server/world.ts';
import { tileLevels } from '#lib/shared/tiles.ts';
import { LIMITS, TOKEN_IMAGE_SIZE, type GalleryResponse } from '#lib/shared/types.ts';

function refuse(status: number, error: string) {
	return Response.json({ ok: false, error } satisfies GalleryResponse, { status });
}

// Looking is for everyone at the table: each is sent what they may see.
export const GET: RequestHandler = (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	return Response.json({ ok: true, items: listGallery(getDb(), actor) } satisfies GalleryResponse);
};

export const POST: RequestHandler = async (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	const gm = actor.role === 'gm';

	// A player sends a token picture and nothing bigger: it is refused before it is read.
	const room = gm ? LIMITS.imageBytes : LIMITS.tokenImageBytes;
	if (Number(event.request.headers.get('content-length') ?? 0) > room + 65536) {
		const what = gm ? 'Map images' : 'Token pictures';
		return refuse(413, `${what} can be up to ${room / 1024 / 1024} MB.`);
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
	// The GM adds either kind. A player adds a token picture, for a token of
	// their own, and keeps only so many: asked before the file is looked at.
	try {
		requireRoomFor(getDb(), actor, kind);
	} catch (err) {
		if (err instanceof ActionError) return refuse(ERROR_STATUS[err.code], err.message);
		throw err;
	}
	const most = kind === 'map' ? LIMITS.imageBytes : LIMITS.tokenImageBytes;
	if (upload.size > most) {
		const what = kind === 'map' ? 'Map images' : 'Token pictures';
		return refuse(413, `${what} can be up to ${most / 1024 / 1024} MB.`);
	}

	const sent = new Uint8Array(await upload.arrayBuffer());
	const format = sniffImage(sent);
	if (!format) return refuse(415, 'Use a PNG, JPEG, WebP, GIF or AVIF image.');
	const sentSize = await imageSize(sent);
	if (!sentSize) return refuse(415, "That file doesn't look like an image that can be read.");
	if (Math.max(sentSize.width, sentSize.height) > LIMITS.imageSide) {
		return refuse(413, `Images can be up to ${LIMITS.imageSide} pixels on a side.`);
	}

	// A map image is kept as it came. A token is a small thing on the map,
	// and many of them share the table, so its picture is kept small.
	let picture: { bytes: Uint8Array; width: number; height: number };
	let extension: ImageFormat = format;
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
		// Whoever has the gallery or the dock open reads it again.
		galleryChanged(actor.campaignId);
		return Response.json({ ok: true, items: listGallery(db, actor) } satisfies GalleryResponse);
	} catch (err) {
		await storage.remove(uploadKey(file));
		if (err instanceof ActionError) return refuse(400, err.message);
		throw err;
	}
};
