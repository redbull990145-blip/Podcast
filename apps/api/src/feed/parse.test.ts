import { describe, expect, it } from 'vitest';
import {
  emptyChannelFeed,
  noGuidFeed,
  notAFeed,
  partiallyBrokenFeed,
  singleEpisodeFeed,
  wellFormedFeed,
} from './fixtures.ts';
import { parseFeed } from './parse.ts';

function parseOk(xml: string) {
  const result = parseFeed(xml);
  if (!result.ok) throw new Error(`expected a parse, got: ${result.reason}`);
  return result;
}

describe('channel metadata', () => {
  const { podcast } = parseOk(wellFormedFeed);

  it('reads the core fields', () => {
    expect(podcast.title).toBe('The Long Way Round');
    expect(podcast.author).toBe('Ada Fielding');
    expect(podcast.websiteUrl).toBe('https://example.com');
    expect(podcast.explicit).toBe(false);
  });

  it('keeps the region in the language tag', () => {
    // pt-BR and pt-PT are different discovery audiences; collapsing to `pt`
    // throws that away.
    expect(podcast.language).toBe('en-gb');
  });

  it('prefers itunes:image, which is square by spec', () => {
    expect(podcast.artworkUrl).toBe('https://cdn.example.com/cover.jpg');
  });

  it('falls back to the RSS <image><url> when there is no itunes:image', () => {
    expect(parseOk(singleEpisodeFeed).podcast.artworkUrl).toBe(
      'https://cdn.example.com/fallback.png',
    );
  });

  it('flattens nested itunes categories and decodes entities', () => {
    expect(podcast.categories).toContain('Society & Culture');
    expect(podcast.categories).toContain('Personal Journals');
  });
});

describe('episodes', () => {
  const { episodes } = parseOk(wellFormedFeed);

  it('reads every usable episode', () => {
    expect(episodes).toHaveLength(2);
  });

  it('keeps HTML and plain text separately', () => {
    // Show notes need the markup; a list row needs text that won't render tags.
    const [first] = episodes;
    expect(first?.descriptionHtml).toContain('<b>beginnings</b>');
    expect(first?.description).toBe('A conversation about beginnings.');
    expect(first?.description).not.toContain('<');
  });

  it('does not invent HTML for a plain-text description', () => {
    expect(episodes[1]?.descriptionHtml).toBeNull();
  });

  it('reads the enclosure as the audio source', () => {
    const [first] = episodes;
    expect(first?.audioUrl).toBe('https://cdn.example.com/ep1.mp3');
    expect(first?.audioType).toBe('audio/mpeg');
    expect(first?.audioLengthBytes).toBe(48210423);
  });

  it('parses both duration formats in one feed', () => {
    expect(episodes[0]?.durationSec).toBe(3750);
    expect(episodes[1]?.durationSec).toBe(3600);
  });

  it('picks up a publisher-provided transcript', () => {
    // Far better than anything we could generate, and free.
    expect(episodes[0]?.transcriptUrl).toBe('https://cdn.example.com/ep1.vtt');
    expect(episodes[0]?.transcriptType).toBe('text/vtt');
  });

  it('reads episode and season numbers', () => {
    expect(episodes[0]?.episodeNumber).toBe(1);
    expect(episodes[0]?.seasonNumber).toBe(1);
  });
});

describe('resilience', () => {
  it('skips unusable episodes instead of failing the show', () => {
    // Losing one episode is recoverable. Losing a subscription because
    // episode 400 had no enclosure is not.
    const result = parseOk(partiallyBrokenFeed);

    expect(result.episodes).toHaveLength(1);
    expect(result.episodes[0]?.guid).toBe('ok-1');
    expect(result.skipped).toBe(3);
  });

  it('keeps the first of two episodes sharing a guid', () => {
    // A duplicate guid would collide on the unique index and abort the insert.
    const result = parseOk(partiallyBrokenFeed);
    expect(result.episodes[0]?.audioUrl).toBe('https://cdn.example.com/ok1.mp3');
  });

  it('handles a one-episode feed, where the parser yields an object not an array', () => {
    expect(parseOk(singleEpisodeFeed).episodes).toHaveLength(1);
  });

  it('falls back to the audio URL when there is no guid', () => {
    // More stable than the title, which publishers edit freely.
    expect(parseOk(noGuidFeed).episodes[0]?.guid).toBe('https://cdn.example.com/no-guid.mp3');
  });

  it('accepts a show with no episodes yet', () => {
    const result = parseOk(emptyChannelFeed);
    expect(result.episodes).toEqual([]);
    expect(result.podcast.title).toBe('Nothing Yet');
  });
});

describe('rejection', () => {
  it('rejects an HTML error page served with a 200', () => {
    // A surprising number of hosts do this instead of a 404.
    const result = parseFeed(notAFeed);
    expect(result.ok).toBe(false);
  });

  it('rejects a feed with no title rather than storing a nameless show', () => {
    const result = parseFeed(
      '<?xml version="1.0"?><rss version="2.0"><channel><description>x</description></channel></rss>',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/title/i);
  });

  it('rejects an empty document without throwing', () => {
    expect(parseFeed('').ok).toBe(false);
  });
});
