/**
 * English — the source catalog.
 *
 * Every other locale is typed against this one, so adding a key here is a
 * compile error in the three files that have not translated it yet. That is
 * deliberate: a missing translation should be caught by `npm run typecheck`,
 * not discovered by a reader in Cairo looking at an English button.
 *
 * Keys are flat and dotted. Nesting reads nicer in a file and worse everywhere
 * else — a flat union of literal keys is what lets TypeScript reject `t('nav.hme')`.
 */

export const en = {
  // ------------------------------------------------------------------ nav --
  'nav.main': 'Main',
  'nav.listen': 'Listen',
  'nav.home': 'Home',
  'nav.search': 'Search',
  'nav.library': 'Library',
  'nav.queue': 'Queue',
  'nav.settings': 'Settings',
  'nav.player': 'Player',
  'nav.downloads': 'Downloads',
  'nav.playlists': 'Playlists',
  /* The subscription list in the sidebar rail. Not a destination — it is the
     shows themselves, listed. */
  'nav.yourShows': 'Your shows',
  'nav.collapseRail': 'Collapse the sidebar',
  'nav.expandRail': 'Expand the sidebar',

  // ---------------------------------------------------------------- theme --
  'theme.toDark': 'Switch to the dark theme',
  'theme.appearance': 'Appearance',
  'theme.appearanceCaption': 'Cue is dark by default. Choose otherwise and it remembers.',
  'theme.nowPlayingTint': 'Colour the app from what’s playing',
  'theme.nowPlayingTintHint':
    'Tints every screen with the current episode’s artwork colour, and changes it when the episode does.',
  'theme.label': 'Theme',
  'theme.hint': 'Until you choose, this follows your system setting.',
  'theme.dark': 'Dark',
  'theme.light': 'Light',
  'theme.toLight': 'Switch to the light theme',
  'theme.system': 'System',
  'theme.systemHint': 'Follow this device',
  'theme.lightHint': 'Warm paper',
  'theme.ember': 'Ember',
  'theme.emberHint': 'Warm dark',
  'theme.onyx': 'Onyx',
  'theme.onyxHint': 'Neutral black',

  // --------------------------------------------------------------- common --
  'common.loading': 'Loading…',
  'common.retry': 'Try again',
  'common.signIn': 'Sign in',
  'common.signOut': 'Sign out',
  'common.cancel': 'Cancel',
  'common.remove': 'Remove',
  'common.save': 'Save',
  'common.offline': 'The server didn’t answer. It may just need a moment.',
  'common.unreachable': 'Couldn’t reach the server',
  'common.checkConnection': 'Check the connection and try again.',

  // ----------------------------------------------------------------- home --
  'home.title': 'Listen',
  'home.lede':
    'Every show streams straight from the people who make it. Nothing to install, and no account needed to press play.',
  'home.searchCta': 'Search shows, topics, people',
  'home.empty': 'Nothing here yet',
  'home.emptyBody':
    'The catalogue is shared, and nobody has added a show yet. Search the directory to find the first one.',
  'home.failedBody': 'The catalogue didn’t load. Search still works while it recovers.',
  'home.continue': 'Continue listening',
  'home.pickUp': 'Pick up where you left off',
  'home.morning': 'Good morning, {name}.',
  'home.afternoon': 'Good afternoon, {name}.',
  'home.evening': 'Good evening, {name}.',
  /* The strip under the greeting. A sentence, not a scoreboard — see
     `ListeningStats` for why Home gets this and Settings gets the charts. */
  'home.statsListened': '{duration} listened',
  'home.statsFinished': '{count, plural, one {# episode finished} other {# episodes finished}}',
  'home.statsShows': '{count, plural, one {# show} other {# shows}}',
  'home.statsMostly': 'mostly',
  'search.browse': 'Browse by category',
  'search.categoryCount': '{count, plural, one {# category} other {# categories}}',
  'search.inCatalogue': '{count, plural, one {# show on Cue} other {# shows on Cue}}',
  'search.allCategories': 'All categories',
  'search.alsoRising': 'Also rising',
  'search.forYou': 'More like what you listen to',
  'search.forYouNote': 'Shows close to the ones you have been playing.',
  'home.alsoInProgress': 'Also in progress',
  'home.startOver': 'Start over',
  'home.latest': 'Latest episodes',
  // Says what the list actually is. It takes the newest episode from each of
  // the most active shows rather than the newest six overall, so one prolific
  // publisher cannot take the whole section — and a heading that did not say
  // so would be quietly lying about the ordering.
  'home.latestNote': 'The newest from each show',
  /* The accessible name for a section's chevron. Never rendered as text — a
     visible "View more" beside every heading is four of the same two words
     down one page. */
  'home.viewMore': 'View more',
  /* The paged rails on Home. The placeholder names which shelf, so a screen
     reader hears "Show more in Recommended for you" rather than several
     identical buttons down one page. */
  'rail.next': 'Show more in {section}',
  'rail.previous': 'Show previous in {section}',
  'rail.goToPage': 'Page {page} of {total}',
  'home.catalogue': 'Everything on Cue',
  /* The same grid as the catalogue, ordered by what someone actually listens
     to. The note matters more than usual here: a personalised order that does
     not say it is personalised reads as an arbitrary one. */
  'home.recommended': 'Recommended for you',
  'home.recommendedNote': 'Shaped by what you’ve been listening to',
  /* The note when there is nothing to personalise from yet. It has to be
     honest that this is the catalogue's order, not the reader's. */
  'home.recommendedGeneric': 'What people are listening to on Cue',
  'home.recommendedLearning':
    'Play {count} or so episodes and this section starts following your taste — the categories you return to, the people you listen to.',
  'home.recommendedBrowse': 'Find something to start with.',
  /* The accent overline on each recommendation card. A rail of covers with no
     explanation is indistinguishable from a rail of random covers — which was
     the original complaint — so every card says which signal put it there. */
  'home.becauseCategory': 'More in {subject}',
  'home.becauseCreator': 'More from {subject}',
  'home.becausePopular': 'Popular right now',
  'home.recentlyPlayed': 'Recently played',
  'home.finished': 'Finished',

  // -------------------------------------------------------------- library --
  'library.title': 'Library',
  'library.signedOut': 'Your shows live here',
  'library.signedOutBody':
    'Sign in to follow shows and pick up where you left off on any device.',
  'library.empty': 'Nothing followed yet',
  'library.emptyBody':
    'Find a show in Search and follow it — new episodes will collect here.',
  'library.searchShows': 'Search shows',
  'library.failed': 'Couldn’t load your library',
  'library.newEpisodes': '{count, plural, one {# new episode} other {# new episodes}}',
  'library.tabShows': 'Following',
  'library.tabPlaylists': 'Playlists',
  'library.groupUnplayed': 'Waiting for you',
  'library.groupActive': 'Still running',
  'library.groupQuiet': 'Gone quiet',

  // --------------------------------------------------------------- search --
  'search.title': 'Search',
  'search.placeholder': 'Shows, topics, people',
  'search.placeholderShort': 'Search podcasts…',
  'search.prompt': 'Find a show',
  'search.promptBody': 'Search the directory by name, topic, or the person who makes it.',
  'search.searching': 'Searching…',
  /* Two characters is not a search, it is the start of one — and querying on
     it returns the directory's idea of everything. Saying so beats showing a
     screen of shows nobody asked for. */
  'search.tooShort': 'Keep typing',
  'search.tooShortBody': 'Three letters is enough to start.',
  'search.noResults': 'No shows matched',
  'search.noResultsBody': 'Try a different spelling, or the host’s name.',
  'search.degraded': 'The podcast directory isn’t responding, so this is only what Cue already knows about. Try again shortly for the full index.',
  'search.filterLanguage': 'Filter by language',
  'search.anyLanguage': 'Any language',
  'search.trending': 'Trending this week',
  'search.add': 'Add',
  'search.adding': 'Adding…',
  'search.added': 'Added',

  // -------------------------------------------------------------- podcast --
  'podcast.failed': 'Couldn’t load this show',
  'podcast.failedBody': 'It may have been removed, or the connection dropped.',
  'podcast.empty': 'No episodes yet',
  'podcast.emptyBody': 'The publisher hasn’t put anything in this feed.',
  'podcast.episodes': 'Episodes',
  'podcast.noEpisodes': 'No episodes have been published yet.',
  'podcast.pagination': 'Episode pages',
  'podcast.pageOf': 'Page {page} of {count}',
  'podcast.previousPage': 'Previous page',
  'podcast.nextPage': 'Next page',
  'podcast.goToPage': 'Go to page {page}',
  'podcast.loadingEpisodes': 'Loading episodes…',
  'podcast.follow': 'Follow',
  'podcast.following': 'Following',
  'podcast.signInToFollow': 'Sign in to follow',
  'podcast.episodeCount': '{count, plural, one {# episode} other {# episodes}}',

  // -------------------------------------------------------------- episode --
  'episode.failed': 'Couldn’t load this episode',
  'episode.failedBody': 'The publisher may have removed it, or the connection dropped.',
  'episode.showNotes': 'Show notes',
  'episode.noNotes': 'The publisher didn’t include notes for this episode.',
  'episode.play': 'Play',
  'episode.pause': 'Pause',
  'episode.addToQueue': 'Add to queue',
  'episode.inQueue': 'In queue',
  'episode.back': 'Back',

  // --------------------------------------------------------------- player --
  'player.nothingPlaying': 'Nothing playing',
  'player.nothingPlayingBody': 'Pick an episode and it will show up here.',
  'player.open': 'Open player',
  'player.close': 'Close player',
  'player.seek': 'Seek',
  'player.position': 'Playback position',
  'player.skipBack': 'Skip back {seconds} seconds',
  'player.skipForward': 'Skip forward {seconds} seconds',
  'player.speed': 'Speed',
  'player.sleepTimer': 'Sleep timer',
  'player.sleepOff': 'Off',
  'player.sleepMinutes': '{count} min',
  'player.stoppingAt': 'Stopping at {time}',
  'player.nowPlaying': 'Now playing: {title}. Open the player.',
  'player.loading': 'Loading…',
  'podcast.needsAccount':
    'This show came from a search. Sign in to play it — and to keep it if you like it.',
  'podcast.signIn': 'Sign in',
  'podcast.enjoying': 'Enjoying this one? Add it to your library so it is easy to find again.',
  'podcast.addToLibrary': 'Add to library',

  'player.volume': 'Volume',
  'player.mute': 'Mute',
  'player.unmute': 'Unmute',
  'player.openQueue': 'Open the queue',
  'player.closeQueue': 'Close the queue',
  /* The queue panel inside the player. `player.upNext` heads the panel;
     `up-next.tsx`'s countdown card uses `player.upNextIn`, which is a different
     sentence about a different moment. */
  'player.upNext': 'Up next',
  'player.queueManage': 'Manage',
  'player.nowPlayingLabel': 'Now playing',
  // Plural-aware: "in 1 second" reads as broken English, and this string is on
  // screen counting down through exactly that value every single time.
  'player.upNextIn': 'Up next in {seconds, plural, one {# second} other {# seconds}}',
  'player.playNow': 'Play now',
  'common.dismiss': 'Dismiss',
  'player.dismiss': 'Close the player',
  'player.speedOpen': 'Playback speed: {rate}×. Choose a speed.',
  'player.speedPresets': 'Speed presets',
  'player.speedFine': 'Fine adjustment',

  // ---------------------------------------------------------------- queue --
  'queue.title': 'Queue',
  'queue.empty': 'Nothing queued',
  'queue.emptyBody': 'Add an episode and it will play after this one.',
  'queue.waiting': '{count, plural, =0 {Queue, empty} one {Queue, # waiting} other {Queue, # waiting}}',
  'queue.remove': 'Remove from queue',
  'queue.clear': 'Clear the queue',

  // ------------------------------------------------------------ downloads --
  'downloads.title': 'Downloads',
  'downloads.save': 'Save for offline',
  'downloads.saved': 'Saved to this device',
  'downloads.remove': 'Remove the download',
  'downloads.cancel': 'Stop downloading',
  'downloads.retry': 'Try downloading again',
  'downloads.waiting': 'Waiting',
  'downloads.working': 'Downloading',
  'downloads.failed': 'Didn’t save',
  'downloads.empty': 'Nothing saved yet',
  'downloads.emptyBody':
    'Save an episode and it plays with no connection at all — on a plane, underground, or anywhere the signal goes.',
  'downloads.usage': '{size} on this device',
  'downloads.count': '{count, plural, one {# episode} other {# episodes}}',
  'downloads.removeTitle': 'Remove the download of {title}',
  'downloads.saveTitle': 'Save {title} for offline',
  'downloads.pending': 'Waiting for a connection',

  // -------------------------------------------------------------- offline --
  'offline.banner': 'Offline — your downloads still play.',
  'offline.bannerWeb': 'Offline — showing what was already loaded.',
  'offline.pageBody':
    'This page hasn’t been opened on this device yet, so there’s no copy of it to show. Anywhere you have already been still works.',
  'offline.title': 'You’re offline',
  'offline.body': 'Saved episodes play as normal. Everything else is waiting for a connection.',
  'offline.openDownloads': 'Open downloads',
  'offline.willSync': 'Where you got to in each episode syncs when you’re back.',
  'offline.nothingSaved': 'Nothing is saved on this device yet, so there is nothing to play.',

  // ------------------------------------------------------------ playlists --
  'playlists.title': 'Playlists',
  'playlists.empty': 'No playlists yet',
  'playlists.emptyBody':
    'A queue answers what to play next. A playlist answers what for — long drives, the ones worth a second listen, the four somebody insisted on.',
  'playlists.create': 'New playlist',
  'playlists.creating': 'Creating…',
  'playlists.name': 'Name',
  'playlists.namePlaceholder': 'Long drives',
  'playlists.describe': 'Description',
  'playlists.describePlaceholder': 'Optional',
  'playlists.count': '{count, plural, =0 {Empty} one {# episode} other {# episodes}}',
  'playlists.addTo': 'Add to a playlist',
  'playlists.inPlaylist': 'In {count, plural, one {# playlist} other {# playlists}}',
  'playlists.remove': 'Remove from this playlist',
  'playlists.removeTitle': 'Remove {title} from this playlist',
  'playlists.playAll': 'Play all',
  'playlists.rename': 'Rename',
  'playlists.save': 'Save',
  'playlists.delete': 'Delete this playlist',
  'playlists.deleteConfirm': 'Delete “{title}”? The episodes themselves stay where they are.',
  'playlists.noEpisodes': 'Nothing in here yet',
  'playlists.noEpisodesBody':
    'Add an episode from anywhere in the app and it collects here, in the order you put it.',
  'playlists.failed': 'Couldn’t load your playlists',
  'playlists.notFound': 'That playlist is gone',
  'playlists.signedOut': 'Playlists need an account',
  'playlists.signedOutBody':
    'They live with your library, so the list you build on one device is there on the next.',
  'playlists.moveUp': 'Move {title} up',
  'playlists.moveDown': 'Move {title} down',
  'playlists.full': 'That playlist is full',
  // The kind question, asked once and never again — see `PLAYLIST_KINDS`.
  'playlists.forWhat': 'What goes in this one?',
  'playlists.forWhatBody':
    'This is fixed once the playlist exists, so the list always knows what it holds.',
  'playlists.kindEpisode': 'Episodes',
  'playlists.kindEpisodeBody': 'An ordered run you can play straight through.',
  'playlists.kindPodcast': 'Shows',
  'playlists.kindPodcastBody': 'A shelf of whole podcasts to come back to.',
  'playlists.countShows': '{count, plural, =0 {Empty} one {# show} other {# shows}}',
  'playlists.emptyShows': 'No show playlists yet',
  'playlists.emptyShowsBody':
    'A shelf for whole podcasts — the ones you keep meaning to start, kept in an order you chose.',
  'playlists.noShows': 'No shows in here yet',
  'playlists.noShowsBody':
    'Add a show from its own page and it collects here, in the order you put it.',
  'playlists.addShowTo': 'Add this show to a playlist',
  'playlists.removeShowTitle': 'Remove {title} from this playlist',
  'playlists.reorderShow': 'Reorder {title}',

  // The refusal, and the way out of it.
  'playlists.wrongKind': 'A whole show can’t go into an episode playlist',
  'playlists.wrongKindBody': '“{title}” holds episodes. Shows need a playlist of their own.',
  'playlists.wrongKindFix': 'Make a show playlist instead',
  'playlists.wrongKindDone': 'Saved to “{title}”',
  'playlists.shows': '{title} (shows)',

  // Dressing one up.
  'playlists.customise': 'Customise',
  'playlists.customiseDone': 'Done',
  'playlists.banner': 'Banner',
  'playlists.bannerColor': 'Colour',
  'playlists.bannerImage': 'Picture',
  'playlists.bannerUpload': 'Choose a picture',
  'playlists.bannerReplace': 'Choose another',
  'playlists.bannerRemove': 'Remove picture',
  'playlists.bannerText': 'Text on the banner',
  'playlists.bannerTextPlaceholder': 'Vol. 3',
  'playlists.background': 'Page colour',
  'playlists.backgroundNone': 'None',
  'playlists.uploading': 'Uploading…',
  'playlists.imageTooBig': 'That picture is over {mb} MB',
  'playlists.imageWrongType': 'That file isn’t a picture we can read',
  // Adding content to a playlist from its own page.
  'playlists.addEpisodes': 'Add episodes',
  'playlists.addShows': 'Add shows',
  'playlists.add': 'Add',
  'playlists.added': 'Added',
  'playlists.followFirst': 'Follow a show first, then its episodes show up here.',

  // ---------------------------------------------------------------- share --
  'share.action': 'Share',
  'share.episode': 'Share this episode',
  'share.fromHere': 'Share from {time}',
  'share.copied': 'Link copied',
  'share.failed': 'Couldn’t copy that link',
  'share.playFrom': 'Play from {time}',
  'share.sharedFrom': 'Shared from {time}',

  // ------------------------------------------------------------- captions --
  'captions.show': 'Show captions',
  'captions.hide': 'Hide captions',
  'captions.none': 'No captions for this episode',
  'captions.noneBody':
    'The publisher didn’t include a transcript. Cue can listen to the episode and write one.',
  'captions.generate': 'Generate captions',
  'captions.generating': 'Writing captions…',
  'captions.working': 'Listening to the episode. This takes a few minutes for a long one — you can keep playing while it runs.',
  'captions.stageStarting': 'Starting up',
  'captions.stageFetching': 'Fetching the audio',
  // Shown instead of the line above once the episode is long enough that the
  // download alone is worth a sentence — see `longDownload` in generate-captions.tsx.
  'captions.stageFetchingLong': 'Fetching the audio — this one’s long, so it may take a minute or two',
  'captions.stageSplitting': 'Cutting it into pieces',
  'captions.stageListening': 'Writing captions — part {done} of {total}',
  'captions.stageAlmost': 'Almost done',
  'captions.stageSaving': 'Lining the words up with the audio',
  /*
    Named as a queue rather than as an error, because that is what it is: the
    shared allowance refills continuously and the job resumes on its own. The
    variant with a time is the one that almost always shows — Groq says when to
    come back and we hold the reader to that same number.
  */
  'captions.stageWaiting': 'Waiting for the shared AI allowance to free up',
  'captions.stageWaitingIn': 'Shared AI allowance is busy — resuming in {time}',
  'captions.cost': 'Uses one of your {remaining, plural, one {# remaining request} other {# remaining requests}} today.',
  'captions.costUnknown': 'Uses one of your daily requests.',
  'captions.noAllowance': 'You’ve used today’s allowance. Add your own API key in Settings to keep going.',
  'captions.signInToGenerate': 'Sign in to generate captions — the daily allowance is per account.',
  'captions.failed': 'Couldn’t start writing captions.',
  'captions.untimed': 'This transcript has no timings, so it can’t follow along.',
  'captions.silence': 'Pause in the conversation',
  'captions.outOfSync': 'Captions out of sync?',
  'captions.sync': 'Sync',
  'captions.syncEarlier': 'Show captions earlier',
  'captions.syncLater': 'Show captions later',
  'captions.syncReset': 'Reset',
  /*
    Deliberately about the *file*, not about the captions being wrong.

    The cues are correct; they are correct about a different copy of this
    episode. Ads are stitched in per request, so the version this listener was
    served is a different length from the one that was transcribed. Saying
    "captions are wrong" would be both inaccurate and unactionable, where naming
    the cause explains why a fix has to be a nudge rather than a repair.
  */
  'captions.differentCut':
    'This episode was transcribed from a copy with different ads, so the timings drift. Nudge them into place.',

  // ----------------------------------------------------------- transcript --
  'transcript.title': 'Transcript',
  'transcript.read': 'Read the transcript',
  'transcript.available': 'This episode ships with a transcript from the publisher.',
  'transcript.loading': 'Loading the transcript…',
  'transcript.failed': 'Couldn’t load the transcript',
  'transcript.none': 'No transcript',
  'transcript.noneBody': 'This publisher doesn’t offer one for this episode.',
  'transcript.unreadable': 'Nothing readable came back from the publisher.',
  'transcript.search': 'Search this transcript…',
  'transcript.searchLabel': 'Search this transcript',
  'transcript.noMatches': 'No matches',
  'transcript.matchCount': '{count, plural, one {# line} other {# lines}}',
  'transcript.follow': 'Follow',
  'transcript.followLabel': 'Follow the audio',
  'transcript.playFrom': 'Play from {time}',
  'transcript.translated': 'Translated into {language}',
  'transcript.translate': 'Translate this transcript',
  'transcript.translating': 'Translating…',
  'transcript.showOriginal': 'Show the original',

  // ------------------------------------------------------------------- ai --
  'ai.title': 'About this episode',
  'ai.open': 'Summary, chapters & questions',
  'ai.signedOut': 'Sign in to use this',
  'ai.signedOutBody':
    'Summaries, chapters and questions are tied to your account’s daily allowance.',
  'ai.signedOutWeb':
    'Sign in to summarise this episode, pull out chapters, or ask about it.',

  'ai.noTranscript': 'No transcript yet',
  'ai.noTranscriptBody':
    'This publisher didn’t provide one. Generating a transcript unlocks the summary, chapters and questions.',
  'ai.transcribing':
    'Listening to the episode and writing it down. This takes a couple of minutes — you can leave this screen.',
  'ai.transcribingShort': 'Transcribing…',
  'ai.generateTranscript': 'Generate a transcript',

  'ai.summary': 'Summary',
  'ai.summaryBody':
    'A few sentences on what this episode actually covered, plus the points worth remembering.',
  'ai.summarise': 'Summarise this episode',

  'ai.chapters': 'Chapters',
  'ai.chaptersBody': 'Divide the episode into sections you can jump between.',
  'ai.chaptersUntimed':
    'Chapters need a transcript with timings. This one is the publisher’s prose, which has none.',
  'ai.findChapters': 'Find the chapters',

  'ai.ask': 'Ask about this episode',
  'ai.askBody':
    'Answered from the transcript only, with the lines it used. If the episode doesn’t cover it, it says so.',
  'ai.askPlaceholder': 'What did they say about…?',
  'ai.askAction': 'Ask',
  'ai.asking': 'Asking…',
  'ai.fromTranscript': 'FROM THE TRANSCRIPT',
  'ai.failed': 'That didn’t work',
  'ai.answerStopped': 'The answer stopped unexpectedly',

  'ai.quotaByok': 'Using your own Groq key (…{hint}). No limit from us.',
  'ai.quotaLeft':
    '{count, plural, one {# AI request left today} other {# AI requests left today}}',
  'ai.quotaSpent':
    'You’ve used today’s AI requests. Add your own Groq key in Settings for unlimited use.',
  'ai.quotaNoOperator': 'Add a Groq API key in Settings to use these — the free tier covers it.',

  // ------------------------------------------------------------- settings --
  'settings.title': 'Settings',
  'settings.playback': 'Playback',
  'settings.playbackCaption':
    'Kept on this device — headphones on a train and a kitchen speaker are not the same speed.',
  'settings.speed': 'Speed',
  'settings.speedHint': 'Applies to everything you play.',
  'settings.skipBack': 'Skip back',
  'settings.skipBackHint': 'You skip back to re-hear something specific.',
  'settings.skipForward': 'Skip forward',
  'settings.skipForwardHint': 'And forward to escape an ad.',

  'settings.language': 'Language',
  'settings.languageCaption':
    'Changes the app’s wording. Your shows stay in whatever language they were published in.',
  'settings.languageHint': 'Applies everywhere, on this device and any other you sign in on.',

  'settings.ai': 'AI',
  'settings.aiCaption':
    'Summaries, chapters and answers come from Groq. There is a shared daily allowance; your own key removes it and bills you instead — the free tier covers ordinary use.',
  'settings.apiKey': 'Groq API key',
  'settings.saveKey': 'Save key',
  'settings.checkingKey': 'Checking…',
  'settings.keySaved': 'Your key is saved (…{hint})',
  'settings.keySavedHint': 'AI features are unlimited and billed to your Groq account.',
  'settings.keyFailed': 'That key could not be saved',
  'settings.removingKey': 'Removing…',
  'settings.quotaWithout':
    'Without one you get {limit} AI requests a day ({remaining} left).',
  'settings.noOperatorKey': 'This server has no shared key, so AI features need your own.',

  'settings.account': 'Account',
  'settings.accountCaption':
    'Browsing, searching and playing all work without one. An account is what carries your library and your place in each episode between devices.',
  'settings.signedIn': 'Signed in',
  'settings.signingOut': 'Signing out…',

  // ----------------------------------------------------------------- auth --
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.name': 'Name',
  'auth.signIn': 'Sign in',
  'auth.signUp': 'Create an account',
  'auth.signingIn': 'Signing in…',
  'auth.noAccount': 'Create an account',
  'auth.haveAccount': 'Sign in instead',

  // --------------------------------------------------------------- format --
  // Words that live inside otherwise numeric output. They belong in the
  // catalog rather than in the formatter, because "min" is not the
  // abbreviation for minutes in most languages.
  'library.latest': 'Latest {date}',
  'search.resultCount': '{count, plural, one {# result} other {# results}}',
  'queue.after': '{count, plural, one {# episode after this one.} other {# episodes after this one.}}',
  'queue.reorder': 'Reorder {title}',
  'queue.removeTitle': 'Remove {title} from the queue',
  'home.timeLeft': '{duration} left',
  'home.resume': 'Resume {title}',

  'settings.restartForDirection': 'Restart the app for the layout to follow the new language.',

  'format.today': 'Today',
  'format.yesterday': 'Yesterday',
  'format.minutes': '{count} min',
  'format.hours': '{count} hr',
  'format.hoursMinutes': '{hours}h {minutes}m',
} as const;

export type MessageKey = keyof typeof en;
export type Catalog = Record<MessageKey, string>;
