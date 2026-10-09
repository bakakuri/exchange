// server/utils/images.js
// Image uploads (proof screenshots, profile photos) arrive as the raw
// request body. The file's own first bytes decide what it is - the
// declared Content-Type must agree - so a renamed file or a script
// dressed up as a picture never reaches Storage.

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', type: 'image/jpeg' };
  }
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', type: 'image/png' };
  }
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { ext: 'webp', type: 'image/webp' };
  }
  return null;
}

// The media type of a raw-body request, without parameters.
function contentTypeOf(req) {
  return String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
}

module.exports = { IMAGE_TYPES, sniffImage, contentTypeOf };
