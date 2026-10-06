const REQUIRED_HASHTAG = '#9jaTrendingTV';
const FALLBACK_TAGS = ['#Nigeria', '#NaijaTrending', '#TrendingInNigeria', '#ViralNigeria'];

const TEMPLATES = [
  ({ topic, context, tags }) => `${topic} is getting Nigerians talking after this moment surfaced online.\n\nWhat is your take on this?\n\n${tags}`,
  ({ topic, context, tags }) => `This one has people reacting already. ${context}\n\nWhat do you think?\n\n${tags}`,
  ({ topic, context, tags }) => `See what happened here. ${context}\n\nWould you call this normal or too much?\n\n${tags}`,
  ({ topic, context, tags }) => `Nigerians are already sharing opinions on this moment involving ${topic}.\n\nWatch and tell us your view below.\n\n${tags}`,
  ({ topic, context, tags }) => `This clip is entering the conversation online. ${context}\n\nWhat would you say about this one?\n\n${tags}`,
  ({ topic, context, tags }) => `${topic} has people talking again with this moment.\n\nValid point or too much?\n\n${tags}`
];

const STOP_WORDS = new Set([
  'the', 'and', 'with', 'from', 'after', 'this', 'that', 'video', 'viral', 'watch',
  'full', 'latest', 'new', 'for', 'you', 'are', 'was', 'were', 'has', 'have'
]);

function cleanText(value = '') {
  return String(value)
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[^\w\s@#.'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPlaceholderTitle(value = '') {
  return /^tiktok\s+video\s+#?\d+$/i.test(cleanText(value))
    || /^video\s+#?\d+$/i.test(cleanText(value));
}

function toTitleCase(value) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function extractTopic(input = {}) {
  const titleSource = isPlaceholderTitle(input.caption || input.title) ? '' : input.caption || input.title;
  const source = cleanText(titleSource || input.uploader || input.platform || '');
  const words = source.split(/\s+/).filter((word) => word.length > 2);
  const properRun = [];

  for (const word of words) {
    const stripped = word.replace(/^[@#]+/, '');
    if (/^[A-Z0-9][A-Za-z0-9.'-]*$/.test(stripped) && !STOP_WORDS.has(stripped.toLowerCase())) {
      properRun.push(stripped);
    }
    if (properRun.length >= 3) break;
  }

  if (properRun.length) {
    return toTitleCase(properRun.join(' '));
  }

  if (input.uploader) {
    return cleanText(input.uploader).slice(0, 60);
  }

  return 'This clip';
}

function makeHashtag(value) {
  const tag = cleanText(value)
    .replace(/^[@#]+/, '')
    .replace(/[^A-Za-z0-9]/g, '');
  if (!tag || tag.length < 3 || /^\d+$/.test(tag)) {
    return null;
  }
  return `#${tag.slice(0, 40)}`;
}

function buildHashtags(topic, input = {}) {
  const tags = [REQUIRED_HASHTAG];
  [topic, input.uploader, input.platform].forEach((value) => {
    const tag = makeHashtag(value);
    if (tag && !tags.includes(tag)) tags.push(tag);
  });

  for (const tag of FALLBACK_TAGS) {
    if (tags.length >= 6) break;
    if (!tags.includes(tag)) tags.push(tag);
  }

  return tags.slice(0, 6).join(' ');
}

function clampCaption(caption) {
  if (caption.length <= 500) return caption;
  return `${caption.slice(0, 470).trim()}...\n\n${REQUIRED_HASHTAG} #Nigeria`;
}

function youtubeTitle(topic) {
  const title = `${topic} Has Nigerians Talking`;
  if (title.length >= 40 && title.length <= 80) return title;
  if (title.length < 40) return `${title} On 9ja Trending TV`;
  return title.slice(0, 77).trim();
}

export function generateCaption(input = {}) {
  if ((process.env.CAPTION_MODE || 'template') !== 'template') {
    throw new Error('Only template caption mode is available right now.');
  }

  const topic = extractTopic(input);
  const rawCaption = isPlaceholderTitle(input.caption || input.title) ? '' : input.caption || input.title || '';
  const cleanedCaption = cleanText(rawCaption);
  const context = cleanedCaption
    ? `Here is the moment people are discussing: ${cleanedCaption.slice(0, 120)}.`
    : 'This moment is already drawing reactions online.';
  const tags = buildHashtags(topic, input);
  const indexSeed = `${topic}${cleanedCaption}`.length % TEMPLATES.length;
  const caption = clampCaption(TEMPLATES[indexSeed]({ topic, context, tags }));
  const title = youtubeTitle(topic);

  console.log('[caption] generated');
  return {
    original: isPlaceholderTitle(input.caption || input.title) ? '' : input.caption || input.title || '',
    generated: caption,
    youtubeTitle: title,
    youtubeDescription: `${caption}\n\nFollow 9ja Trending TV - What Nigeria Is Talking About.`
  };
}
