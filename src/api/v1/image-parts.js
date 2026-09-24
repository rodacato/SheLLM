const { invalidRequest } = require('../../errors');
const config = require('../../config');

// Only inline images: fetching a caller's URL from the server would be an SSRF.
const DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SIGNATURES = {
  'image/jpeg': (head) => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
  'image/png': (head) => head.subarray(0, 8).equals(PNG_SIGNATURE),
  'image/gif': (head) => head.subarray(0, 4).toString('latin1') === 'GIF8',
  'image/webp': (head) => head.subarray(0, 4).toString('latin1') === 'RIFF'
    && head.subarray(8, 12).toString('latin1') === 'WEBP',
};

function decodedSize(base64) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

function marker(number) {
  return `[image ${number}]`;
}

function renderParts(parts) {
  return parts.map((part) => (part.type === 'text' ? part.text : marker(part.number))).join('');
}

// A wrong media type would otherwise reach the provider and come back as a 502.
function imagePart(imageUrl, where, number) {
  const url = imageUrl?.url;
  if (typeof url !== 'string') {
    return { error: invalidRequest(`${where}.image_url must be an object with a "url" string`) };
  }
  if (!url.startsWith('data:')) {
    return { error: invalidRequest(`${where}.image_url must be a data: URL; SheLLM does not fetch remote images`) };
  }
  const match = DATA_URL.exec(url);
  if (!match || match[2].length % 4 !== 0) {
    return { error: invalidRequest(`${where}.image_url must be a base64 data: URL of an image/jpeg, image/png, image/webp or image/gif`) };
  }

  const [, media_type, data] = match;
  const bytes = decodedSize(data);
  const maxBytes = config.get('SHELLM_MAX_IMAGE_BYTES');
  if (bytes > maxBytes) {
    return { error: invalidRequest(`${where}: image is ${bytes} bytes, the limit is ${maxBytes}; resize it before sending`) };
  }
  if (!SIGNATURES[media_type](Buffer.from(data.slice(0, 16), 'base64'))) {
    return { error: invalidRequest(`${where}: image content is not ${media_type}`) };
  }
  return { part: { type: 'image', number, media_type, data } };
}

function maxImages() {
  return config.get('SHELLM_MAX_IMAGES');
}

module.exports = { imagePart, renderParts, marker, maxImages };
