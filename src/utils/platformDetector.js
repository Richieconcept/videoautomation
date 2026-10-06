import dns from 'node:dns/promises';
import net from 'node:net';
import { UnsupportedPlatformError, ValidationError } from './errors.js';

const SUPPORTED_HOSTS = {
  tiktok: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'],
  facebook: ['facebook.com', 'www.facebook.com', 'fb.watch', 'm.facebook.com'],
  youtube: ['youtube.com', 'www.youtube.com', 'youtu.be']
};

const PRIVATE_CIDR_HINTS = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^0\./
];

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/\.$/, '');
}

function isSupportedHost(hostname, candidates) {
  return candidates.some((candidate) => hostname === candidate || hostname.endsWith(`.${candidate}`));
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    return PRIVATE_CIDR_HINTS.some((pattern) => pattern.test(address));
  }

  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:');
  }

  return false;
}

export function parseAndValidateUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string' || !inputUrl.trim()) {
    throw new ValidationError('Please paste a TikTok, Facebook, or YouTube URL.');
  }

  let parsed;
  try {
    parsed = new URL(inputUrl.trim());
  } catch {
    throw new ValidationError('That does not look like a valid URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ValidationError('Only http and https URLs are supported.');
  }

  parsed.hash = '';
  return parsed;
}

export function detectPlatform(inputUrl) {
  const parsed = parseAndValidateUrl(inputUrl);
  const hostname = normalizeHostname(parsed.hostname);

  if (isSupportedHost(hostname, SUPPORTED_HOSTS.tiktok)) {
    return parsed.pathname.startsWith('/live') ? 'tiktok' : 'tiktok';
  }

  if (isSupportedHost(hostname, SUPPORTED_HOSTS.facebook)) {
    return 'facebook';
  }

  if (isSupportedHost(hostname, SUPPORTED_HOSTS.youtube)) {
    return parsed.pathname.startsWith('/shorts/') ? 'youtube_shorts' : 'youtube';
  }

  throw new UnsupportedPlatformError();
}

export async function validatePublicNetworkTarget(inputUrl) {
  const parsed = parseAndValidateUrl(inputUrl);
  const hostname = normalizeHostname(parsed.hostname);

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new ValidationError('Localhost URLs are not allowed.');
  }

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new ValidationError('Private or local network URLs are not allowed.');
    }
    return;
  }

  try {
    const records = await dns.lookup(hostname, { all: true });
    if (records.some((record) => isPrivateAddress(record.address))) {
      throw new ValidationError('Private or local network URLs are not allowed.');
    }
  } catch {
    throw new ValidationError('Could not validate the URL host.');
  }
}
