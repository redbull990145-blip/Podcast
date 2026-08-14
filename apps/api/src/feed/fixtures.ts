/**
 * Feed fixtures.
 *
 * These are not tidy examples — each one encodes a way real feeds break, so
 * the parser is tested against the wild rather than against the spec.
 */

/** A well-formed feed using the fields publishers actually populate. */
export const wellFormedFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>The Long Way Round</title>
    <link>https://example.com</link>
    <description>Conversations with people who took the scenic route.</description>
    <language>en-GB</language>
    <itunes:author>Ada Fielding</itunes:author>
    <itunes:explicit>no</itunes:explicit>
    <itunes:image href="https://cdn.example.com/cover.jpg"/>
    <itunes:category text="Society &amp; Culture">
      <itunes:category text="Personal Journals"/>
    </itunes:category>
    <item>
      <title>Starting from nothing</title>
      <guid isPermaLink="false">episode-001</guid>
      <pubDate>Tue, 05 Aug 2026 09:00:00 GMT</pubDate>
      <description><![CDATA[<p>A conversation about <b>beginnings</b>.</p>]]></description>
      <content:encoded><![CDATA[<p>A conversation about <b>beginnings</b>.</p>]]></content:encoded>
      <enclosure url="https://cdn.example.com/ep1.mp3" type="audio/mpeg" length="48210423"/>
      <itunes:duration>1:02:30</itunes:duration>
      <itunes:episode>1</itunes:episode>
      <itunes:season>1</itunes:season>
      <podcast:transcript url="https://cdn.example.com/ep1.vtt" type="text/vtt"/>
    </item>
    <item>
      <title>The second one</title>
      <guid>episode-002</guid>
      <pubDate>Tue, 12 Aug 2026 09:00:00 GMT</pubDate>
      <description>Plain text description, no markup at all.</description>
      <enclosure url="https://cdn.example.com/ep2.mp3" type="audio/mpeg" length="51000000"/>
      <itunes:duration>3600</itunes:duration>
    </item>
  </channel>
</rss>`;

/**
 * One episode is unusable (no enclosure), one has an unparseable date, and one
 * repeats a guid. A parser that fails the whole feed on any of these loses a
 * subscription over a single bad row.
 */
export const partiallyBrokenFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Mostly Fine</title>
    <description>A feed with the usual problems.</description>
    <item>
      <title>Good episode</title>
      <guid>ok-1</guid>
      <pubDate>Wed, 06 Aug 2026 12:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/ok1.mp3" type="audio/mpeg"/>
    </item>
    <item>
      <title>No audio anywhere</title>
      <guid>broken-no-enclosure</guid>
      <pubDate>Wed, 06 Aug 2026 12:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Nonsense date</title>
      <guid>broken-date</guid>
      <pubDate>sometime last spring</pubDate>
      <enclosure url="https://cdn.example.com/bad-date.mp3" type="audio/mpeg"/>
    </item>
    <item>
      <title>Duplicate guid, newer revision</title>
      <guid>ok-1</guid>
      <pubDate>Thu, 07 Aug 2026 12:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/ok1-v2.mp3" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`;

/** A single-episode feed: fast-xml-parser yields an object, not an array. */
export const singleEpisodeFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Just Started</title>
    <description>One episode so far.</description>
    <image><url>https://cdn.example.com/fallback.png</url></image>
    <item>
      <title>Hello</title>
      <guid>only-one</guid>
      <pubDate>Mon, 03 Aug 2026 08:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/hello.mp3" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`;

/** No guid anywhere — identity has to fall back to the audio URL. */
export const noGuidFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Guidless</title>
    <description>Publisher never set a guid.</description>
    <item>
      <title>An episode</title>
      <pubDate>Mon, 03 Aug 2026 08:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/no-guid.mp3" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`;

export const notAFeed = `<!DOCTYPE html><html><body><h1>404 Not Found</h1></body></html>`;

export const emptyChannelFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Nothing Yet</title><description>Soon.</description></channel></rss>`;
