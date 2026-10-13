import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebAudioEngine } from './web-engine';

vi.mock('./frame-clock', () => ({ subscribeToFrames: () => () => undefined }));
class AudioDouble extends EventTarget {
  src = '';
  currentTime = 0;
  readyState = 0;
  duration = 100;
  load() { this.readyState = 0; }
  pause() { this.dispatchEvent(new Event('pause')); }
  play() { return Promise.resolve(); }
  removeAttribute() { this.src = ''; }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('cancelled web resume seek', () => {
  it('bounds a stalled resumed source and clears its metadata handlers', async () => {
    vi.useFakeTimers(); const audio = new AudioDouble();
    vi.stubGlobal('Audio', vi.fn(function () { return audio; })); vi.stubGlobal('HTMLMediaElement', { HAVE_METADATA: 1 });
    const engine = new WebAudioEngine(); const load = engine.load('https://publisher.test/stalled.mp3', 60);
    const rejected = expect(load).rejects.toThrow('too long'); await vi.advanceTimersByTimeAsync(15_000); await rejected;
    audio.readyState = 1; audio.dispatchEvent(new Event('loadedmetadata')); expect(audio.currentTime).toBe(0);
    expect(vi.getTimerCount()).toBe(0); engine.destroy();
  });
  it('rejects old source events after replacement and flushes the ending source before advancing', async () => {
    const sources: AudioDouble[] = [];
    vi.stubGlobal('Audio', vi.fn(function () { const audio = new AudioDouble(); sources.push(audio); return audio; }));
    const engine = new WebAudioEngine(); const events = vi.fn(); engine.subscribe(events);
    await engine.load('https://publisher.test/A.mp3', 0);
    sources[0]!.dispatchEvent(new Event('play'));
    await engine.load('https://publisher.test/B.mp3', 0); events.mockClear();
    for (const type of ['ended', 'error', 'loadedmetadata', 'play', 'pause']) sources[0]!.dispatchEvent(new Event(type));
    expect(events).not.toHaveBeenCalled();
    sources[1]!.currentTime = 99; sources[1]!.dispatchEvent(new Event('play')); events.mockClear();
    sources[1]!.dispatchEvent(new Event('ended'));
    expect(events.mock.calls.map((call) => call[0].type)).toEqual(['position', 'ended']);
    engine.destroy();
  });
  it('removes an old metadata callback before the new source is ready', async () => {
    const audio = new AudioDouble();
    vi.stubGlobal('Audio', vi.fn(function () { return audio; }));
    vi.stubGlobal('HTMLMediaElement', { HAVE_METADATA: 1 });
    const engine = new WebAudioEngine();
    const old = engine.load('https://publisher.test/A.mp3', 60);
    const current = engine.load('https://publisher.test/B.mp3', 20);
    audio.readyState = 1; audio.dispatchEvent(new Event('loadedmetadata'));
    await Promise.all([old, current]); expect(audio.currentTime).toBe(20);
    engine.destroy();
  });
  it('cancels a pending seek when account playback is reset', async () => {
    const audio = new AudioDouble();
    vi.stubGlobal('Audio', vi.fn(function () { return audio; }));
    vi.stubGlobal('HTMLMediaElement', { HAVE_METADATA: 1 });
    const engine = new WebAudioEngine(); const pending = engine.load('https://publisher.test/A.mp3', 60);
    engine.cancelLoad(); await pending;
    audio.readyState = 1; audio.dispatchEvent(new Event('loadedmetadata'));
    expect(audio.currentTime).toBe(0); engine.destroy();
  });
});
