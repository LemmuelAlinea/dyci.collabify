import type { PaletteColors } from './palette'

/**
 * Palettes that ship with the product, to start from. Kept in code rather than
 * the database: they are the same for everyone, and applying one copies its
 * colors into the person's own, which they can then change.
 */
export type Preset = { id: string; name: string; note: string; colors: PaletteColors }

export const PRESETS: Preset[] = [
  {
    id: 'default',
    name: 'Collabify default',
    note: 'Navy banners, green for done, amber for in progress, red for late.',
    colors: {},
  },
  {
    id: 'colorblind',
    name: 'Colorblind-friendly',
    note: 'Blue, orange and vermilion, which stay apart for red-green color blindness.',
    colors: {
      light: {
        success: '#0072b2',
        warning: '#e69f00',
        danger: '#d55e00',
        progress: '#0072b2',
      },
      dark: {
        success: '#56b4e9',
        warning: '#e69f00',
        danger: '#d55e00',
        progress: '#56b4e9',
      },
    },
  },
  {
    id: 'contrast',
    name: 'High contrast',
    note: 'Black banners and stronger colors, for bright rooms and projectors.',
    colors: {
      light: {
        banner: '#000000',
        bannerAccent: '#ffd000',
        success: '#007a3d',
        warning: '#b36b00',
        danger: '#c00000',
        pending: '#333a55',
        navIcon: '#10162e',
        navActive: '#000000',
        progress: '#007a3d',
        badge: '#c00000',
      },
      dark: {
        banner: '#000000',
        bannerAccent: '#ffd000',
        success: '#3ddc84',
        warning: '#ffb000',
        danger: '#ff5c5c',
        pending: '#d0d6ea',
        navIcon: '#eef1fa',
        navActive: '#ffd000',
        progress: '#3ddc84',
        badge: '#ff5c5c',
      },
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    note: 'Deep green banners with a leaf accent.',
    colors: {
      light: {
        banner: '#0f2a1d',
        bannerAccent: '#a3d977',
        success: '#2f9e44',
        warning: '#e8a33d',
        danger: '#d9480f',
        navActive: '#2f6b3f',
        progress: '#2f9e44',
        badge: '#e8a33d',
      },
      dark: {
        banner: '#0f2a1d',
        bannerAccent: '#a3d977',
        success: '#51cf66',
        warning: '#e8a33d',
        danger: '#ff6b3d',
        navActive: '#a3d977',
        progress: '#51cf66',
        badge: '#a3d977',
      },
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    note: 'Sea-blue banners, with progress in blue.',
    colors: {
      light: {
        banner: '#0b2540',
        bannerAccent: '#5ec8e5',
        success: '#12b886',
        warning: '#fab005',
        danger: '#fa5252',
        navActive: '#1c5d99',
        progress: '#1c7ed6',
        badge: '#1c7ed6',
      },
      dark: {
        banner: '#0b2540',
        bannerAccent: '#5ec8e5',
        success: '#20c997',
        warning: '#fab005',
        danger: '#ff6b6b',
        navActive: '#5ec8e5',
        progress: '#4dabf7',
        badge: '#5ec8e5',
      },
    },
  },
]
