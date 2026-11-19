// Serves a campaign's pictures: the images under its maps and the pictures
// on its tokens. What is in the gallery is open to the whole table. See
// `canLoadImage` for the ones that have been taken out of it.

import { type RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { canLoadImage } from '#lib/server/gallery.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { getStorage } from '#lib/server/storage.ts';
import { thumbOf, tilesOf, uploadKey } from '#lib/server/tiles.ts';
import { IMAGE_FILE_PATTERN } from '#lib/server/world.ts';

const CONTENT_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif'
};

function refuse(status: number, error: string) {
	return Response.json({ ok: false, error }, { status });
}

export const GET: RequestHandler = async (event) => {
	const { user, campaign } = requireMemberApi(event, event.params.campaign!);
	const file = event.params.file!;
	const who = { role: campaign.role, userId: user.id };
	// A picture that isn't this person's to see is, to them, not there.
	if (!IMAGE_FILE_PATTERN.test(file) || !canLoadImage(getDb(), campaign.id, who, file)) {
		return refuse(404, 'Image not found');
	}

	const storage = getStorage();
	let key = uploadKey(file);
	if (!(await storage.has(key))) return refuse(404, 'Image not found');
	let type = CONTENT_TYPES[file.slice(file.lastIndexOf('.') + 1)];

	// `part` asks for something made from the picture instead of the file
	// itself: its thumbnail, and for a big map image its preview, or one
	// tile as `level/x/y`.
	const part = event.url.searchParams.get('part');
	if (part !== null) {
		const tile = part.match(/^(\d+)\/(\d+)\/(\d+)$/);
		if (part === 'thumb') {
			key = await thumbOf(file);
		} else if (tile || part === 'preview') {
			const pieces = await tilesOf(file);
			key = tile ? pieces.tile(+tile[1], +tile[2], +tile[3]) : pieces.preview;
		} else {
			return refuse(404, 'Image not found');
		}
		type = 'image/webp';
	}
	const blob = await storage.get(key);
	if (!blob) return refuse(404, 'Image not found');

	return new Response(blob, {
		headers: {
			'content-type': type,
			// A file name is never used twice, so what it names never changes.
			'cache-control': 'private, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox"
		}
	});
};
