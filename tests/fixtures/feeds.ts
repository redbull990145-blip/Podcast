/**
 * Feed fixtures.
 *
 * These are deliberately not "clean" examples. Each one encodes a real shape we
 * have to survive: full Podcasting 2.0 metadata, a bare-minimum feed with none
 * of it, and a feed where half the fields are missing or malformed.
 */

/** Well-produced show: PC20 namespace, chapters, transcripts, nested categories. */
export const PC20_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:podcast="https://podcastindex.org/namespace/1.0"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>The Signal Path</title>
    <link>https://signalpath.example/</link>
    <description>Long-form conversations about engineering.</description>
    <language>en-us</language>
    <lastBuildDate>Tue, 15 Jul 2025 09:00:00 GMT</lastBuildDate>
    <itunes:author>Dana Okafor</itunes:author>
    <itunes:image href="https://cdn.example/art/signalpath.jpg"/>
    <itunes:category text="Technology">
      <itunes:category text="Software How-To"/>
    </itunes:category>
    <itunes:category text="Science"/>
    <item>
      <title>Why your build is slow</title>
      <guid isPermaLink="false">sp-042</guid>
      <pubDate>Tue, 15 Jul 2025 09:00:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>A deep dive into <b>caching</b>.</p>]]></content:encoded>
      <enclosure url="https://cdn.example/audio/sp-042.mp3" length="48210331" type="audio/mpeg"/>
      <itunes:duration>1:02:03</itunes:duration>
      <itunes:episode>42</itunes:episode>
      <itunes:season>3</itunes:season>
      <itunes:image href="https://cdn.example/art/sp-042.jpg"/>
      <podcast:chapters url="https://cdn.example/chapters/sp-042.json" type="application/json+chapters"/>
      <podcast:transcript url="https://cdn.example/tx/sp-042.srt" type="application/srt"/>
      <podcast:transcript url="https://cdn.example/tx/sp-042.vtt" type="text/vtt"/>
    </item>
    <item>
      <title>The cost of abstraction</title>
      <guid isPermaLink="false">sp-041</guid>
      <pubDate>Tue, 08 Jul 2025 09:00:00 GMT</pubDate>
      <description>Where indirection stops paying for itself.</description>
      <enclosure url="https://cdn.example/audio/sp-041.mp3" length="41002110" type="audio/mpeg"/>
      <itunes:duration>3540</itunes:duration>
      <itunes:episode>41</itunes:episode>
    </item>
  </channel>
</rss>`;

/** Bare RSS 2.0: no iTunes namespace at all. Common for self-hosted shows. */
export const MINIMAL_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Garage Notes</title>
    <link>https://garagenotes.example</link>
    <description>Just a person and a microphone.</description>
    <item>
      <title>First one</title>
      <pubDate>Mon, 03 Mar 2025 12:00:00 GMT</pubDate>
      <enclosure url="https://garagenotes.example/ep1.mp3" length="12000000" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`;

/**
 * Hostile edge cases in one feed:
 *  - an item with no enclosure (a web-only post) that must be skipped
 *  - a missing guid that must fall back to the enclosure URL
 *  - an unparseable duration, a negative duration, and an "MM:SS" duration
 *  - an unparseable pubDate
 *  - a non-numeric enclosure length
 */
export const MESSY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>   Rough Cuts   </title>
    <description></description>
    <item>
      <title>No audio here</title>
      <guid>rc-web-only</guid>
      <link>https://roughcuts.example/post</link>
    </item>
    <item>
      <title>Missing guid</title>
      <pubDate>not a real date</pubDate>
      <enclosure url="https://roughcuts.example/rc-2.mp3" length="notanumber" type="audio/mpeg"/>
      <itunes:duration>45:30</itunes:duration>
    </item>
    <item>
      <guid>rc-3</guid>
      <enclosure url="https://roughcuts.example/rc-3.mp3" type="audio/mpeg"/>
      <itunes:duration>garbage</itunes:duration>
    </item>
    <item>
      <title>Negative duration</title>
      <guid>rc-4</guid>
      <enclosure url="https://roughcuts.example/rc-4.mp3" type="audio/mpeg"/>
      <itunes:duration>-90</itunes:duration>
    </item>
  </channel>
</rss>`;

/** Not XML at all — e.g. a publisher serving an HTML error page with a 200. */
export const NOT_A_FEED = `<!doctype html><html><body><h1>404</h1></body></html>`;
