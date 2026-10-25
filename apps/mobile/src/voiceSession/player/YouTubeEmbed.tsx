import { useTranslations } from '@nomad/i18n';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { openYouTubeUrl, youtubeId } from '../../media/youtube';
import type { PlayerEvent, PlayerHandle } from './KaraokePlayer';

/**
 * Our own YouTube IFrame Player API page (spike D1 player C). It is loaded as an HTML string with
 * `baseUrl: 'https://nomadkaraoke.com'` and `origin` to match: without a referrer YouTube refuses with Error 153.
 * The page never starts the video itself. It posts `ready`, then waits for `play` (see KaraokePlayer for the iOS
 * start order). Messages: `{t:'ready'}`, `{t:'state', v}` (YT.PlayerState), `{t:'error', v}` (code, or absent), and
 * `{t:'time', v, s}` once a second.
 */
export const EMBED_BASE_URL = 'https://nomadkaraoke.com';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Our player page's own URL (the HTML string's base URL), or a path under it. */
const isOurPage = (url: string | undefined) => !!url && (url === EMBED_BASE_URL || url.startsWith(`${EMBED_BASE_URL}/`));
/** The YouTube player's own iframe document (Android reports every navigation as top-frame, so allow it by URL). */
const EMBED_FRAME = /^https:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\//i;

/** A link out of the player (the YouTube logo, title, "Watch on YouTube") opens in the YouTube app, not in the page. */
function handOff(url: string): void {
  if (youtubeId(url) && !EMBED_FRAME.test(url)) void openYouTubeUrl(url).catch(() => {});
}

/**
 * Keeps the WebView on our player page: only sub-frame loads (the YouTube iframe and its own resources), our page and
 * about:blank may load. A blocked top-frame YouTube link goes to the YouTube app instead. Navigating away would
 * stall the session and hand our postMessage bridge to youtube.com.
 */
export function allowEmbedLoad(req: { url: string; isTopFrame?: boolean }): boolean {
  if (req.isTopFrame === false || isOurPage(req.url) || req.url.startsWith('about:') || EMBED_FRAME.test(req.url)) return true;
  handOff(req.url);
  return false;
}

export function playerHtml(videoId: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;background:#000;height:100%}#p{width:100%;height:100%}</style></head><body>
<div id="p"></div>
<script>
function post(o){window.ReactNativeWebView.postMessage(JSON.stringify(o));}
var player;
var tag=document.createElement('script');tag.src='https://www.youtube.com/iframe_api';document.head.appendChild(tag);
function onYouTubeIframeAPIReady(){
  player=new YT.Player('p',{videoId:${JSON.stringify(videoId)},width:'100%',height:'100%',
   playerVars:{playsinline:1,rel:0,origin: '${EMBED_BASE_URL}',enablejsapi:1,controls:1,fs:1},
   events:{
    onReady:function(){post({t:'ready'});},
    onStateChange:function(e){post({t:'state',v:e.data});},
    onError:function(e){post({t:'error',v:e.data});}
   }});
  setInterval(function(){try{post({t:'time',v:player.getCurrentTime(),s:player.getPlayerState()});}catch(e){}},1000);
}
window.nomadCmd=function(c){try{if(c==='play')player.playVideo();if(c==='pause')player.pauseVideo();}catch(e){}};
</script></body></html>`;
}

// YT.PlayerState
const PLAYING = 1;
const ENDED = 0;

export type YouTubeEmbedProps = {
  videoId: string;
  onEvent: (e: PlayerEvent) => void;
  ref?: Ref<PlayerHandle>;
};

/**
 * The embedded video, 16:9. Any player error (2, 5, 100, 101, 150, 152, 153, an unknown code, or none at all) is
 * `unplayable`: an embedding-disabled video and a removed one both give 150, and Error 153 can arrive without a code.
 * `playing` is reported once (the first time the video plays), `ended` when it finishes; nothing after either end.
 */
export function YouTubeEmbed({ videoId, onEvent, ref }: YouTubeEmbedProps) {
  const t = useTranslations('voiceSession.player');
  const web = useRef<WebView>(null);
  const emit = useRef(onEvent);
  useEffect(() => {
    emit.current = onEvent;
  });
  const readied = useRef(false);
  const played = useRef(false);
  const done = useRef(false);
  const valid = VIDEO_ID.test(videoId);

  const finish = (e: PlayerEvent) => {
    if (done.current) return;
    done.current = true;
    emit.current(e);
  };

  useEffect(() => {
    // YouTube's own code for an invalid id.
    if (!valid) finish({ kind: 'unplayable', code: 2 });
  }, [valid]);

  const command = (c: 'play' | 'pause') => web.current?.injectJavaScript(`window.nomadCmd && window.nomadCmd('${c}');true;`);
  useImperativeHandle(ref, () => ({ play: () => command('play'), pause: () => command('pause') }), []);

  const onMessage = (e: WebViewMessageEvent) => {
    if (done.current || !isOurPage(e.nativeEvent.url)) return;
    let m: { t?: unknown; v?: unknown };
    try {
      m = JSON.parse(e.nativeEvent.data) as typeof m;
    } catch {
      return;
    }
    if (m.t === 'ready') {
      if (readied.current) return;
      readied.current = true;
      emit.current({ kind: 'ready' });
    }
    else if (m.t === 'error') finish({ kind: 'unplayable', code: typeof m.v === 'number' || typeof m.v === 'string' ? m.v : 'unknown' });
    else if (m.t === 'state' && m.v === PLAYING && !played.current) {
      played.current = true;
      emit.current({ kind: 'playing' });
    } else if (m.t === 'state' && m.v === ENDED) finish({ kind: 'ended' });
  };

  return (
    <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' }}>
      {valid ? (
        <WebView
          ref={web}
          testID="vs-player-embed"
          accessibilityLabel={t('video')}
          style={{ flex: 1, backgroundColor: '#000' }}
          originWhitelist={['https://*']}
          source={{ html: playerHtml(videoId), baseUrl: EMBED_BASE_URL }}
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          domStorageEnabled
          onMessage={onMessage}
          onShouldStartLoadWithRequest={allowEmbedLoad}
          setSupportMultipleWindows={false}
          onOpenWindow={(e) => handOff(e.nativeEvent.targetUrl)}
          // iOS can kill the web content process (memory pressure): reload our page rather than show a blank box.
          onContentProcessDidTerminate={() => web.current?.reload()}
        />
      ) : null}
    </View>
  );
}
