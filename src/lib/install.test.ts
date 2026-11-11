import { describe, expect, it } from 'vitest'
import { installRoute } from './install'

const UA = {
  androidChrome:
    'Mozilla/5.0 (Linux; Android 15; 24091RPADG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  ipadDesktopMode:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
  messengerAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-A155F Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.0.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/480.0.0.0;]',
  facebookIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0]',
}
const plain = { standalone: false, hasPrompt: false }

describe('installRoute', () => {
  it('says nothing is left to do inside the installed app', () => {
    expect(installRoute(UA.androidChrome, { standalone: true, hasPrompt: true })).toBe('installed')
  })
  it('uses the browser prompt when there is one', () => {
    expect(installRoute(UA.androidChrome, { standalone: false, hasPrompt: true })).toBe('prompt')
    expect(installRoute(UA.windowsEdge, { standalone: false, hasPrompt: true })).toBe('prompt')
  })
  it('sends a browser inside Messenger or Facebook out to a real browser first', () => {
    expect(installRoute(UA.messengerAndroid, plain)).toBe('in-app')
    expect(installRoute(UA.facebookIphone, plain)).toBe('in-app')
    // Even if one of them claims a prompt, it cannot finish the install.
    expect(installRoute(UA.messengerAndroid, { standalone: false, hasPrompt: true })).toBe('in-app')
  })
  it('gives iPhone and iPad the Home Screen steps, iPad in desktop mode included', () => {
    expect(installRoute(UA.iphoneSafari, plain)).toBe('ios')
    expect(installRoute(UA.ipadDesktopMode, { ...plain, touchPoints: 5 })).toBe('ios')
  })
  it('tells a Mac apart from an iPad by its touch points', () => {
    expect(installRoute(UA.macSafari, { ...plain, touchPoints: 0 })).toBe('desktop')
  })
  it('falls back to the browser menu on Android and on a computer', () => {
    expect(installRoute(UA.androidChrome, plain)).toBe('android')
    expect(installRoute(UA.windowsChrome, plain)).toBe('desktop')
    expect(installRoute(UA.windowsEdge, plain)).toBe('desktop')
  })
  it('says Firefox on a computer cannot install', () => {
    expect(installRoute(UA.windowsFirefox, plain)).toBe('unsupported')
  })
})
