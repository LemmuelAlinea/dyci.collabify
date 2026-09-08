import type { LegalDoc } from './types'

/**
 * The cookies and local storage notice.
 *
 * It opens by saying there are no cookies because that is the true and
 * surprising fact, and burying it under a table of categories nobody reads
 * would waste the one advantage this app has over most sites.
 *
 * There is no banner, and adding one would be worse than not having one: a
 * consent banner on a site that sets nothing to consent to trains people to
 * dismiss banners without reading them, which is the habit that makes the
 * banners on sites that *do* track them useless. Article 2 of the Act's IRR
 * asks for transparency, not for a modal.
 *
 * The keys below were read out of the code, not assumed. If a fifth key is
 * ever written, it belongs in this table before it ships.
 */
export const COOKIES: LegalDoc = {
  slug: 'cookies',
  title: `Cookies and local storage`,
  kicker: `What is kept in your browser`,
  summary: `Collabify sets no cookies. Four things are stored in your browser, and all four are needed for it to work.`,
  version: `2026-09-08`,
  effective: `2026-09-08`,
  sections: [
    {
      id: 'no-cookies',
      heading: `Collabify sets no cookies`,
      blocks: [
        {
          kind: 'p',
          text: `Not for analytics, not for advertising, not for sign-in. There is no tracking pixel, no analytics script and no advertising network anywhere in it, so there is nothing to opt out of.`,
        },
        {
          kind: 'p',
          text: `What it does use is local storage — a place your browser keeps small values for one site. Nothing there is sent to a server automatically the way a cookie is; the app reads it when it needs it. There are four things in it.`,
        },
      ],
    },

    {
      id: 'what-is-stored',
      heading: `What is stored`,
      blocks: [
        {
          kind: 'table',
          head: [`Key`, `What it holds`, `How long`],
          rows: [
            [
              `sb-…-auth-token`,
              `Your sign-in session, so you stay signed in between visits. Written by the sign-in service`,
              `Until you sign out, or it expires`,
            ],
            [
              `collabify.theme`,
              `Whether you chose light or dark. Read before the page paints, so it does not flash the wrong one`,
              `Until you clear it`,
            ],
            [
              `collabify:rl:…`,
              `A count of failed sign-in, signup or password-reset attempts, so the form can tell you the wait before you submit`,
              `Cleared on success, and on sign-out`,
            ],
            [
              `collabify.notices.about`,
              `Whether you dismissed an explanatory panel on the admin notices screen. Administrators only`,
              `Until you clear it`,
            ],
          ],
        },
        {
          kind: 'p',
          text: `All four are strictly necessary. Clearing them signs you out, resets your theme to your system setting, and forgets the dismissed panel; nothing about your coursework is affected, because none of it lives here.`,
        },
        {
          kind: 'note',
          text: `The attempt counter is keyed by a short code derived from the address you typed, not by the address itself. That code is not the address and cannot be read back as one at a glance, but it is a short non-cryptographic hash and somebody who guessed a candidate address could confirm a match. It exists so a shared machine does not display the last person's email address in plain text.`,
        },
      ],
    },

    {
      id: 'third-parties',
      heading: `Requests to other companies`,
      blocks: [
        {
          kind: 'p',
          text: `The pages you can see without signing in — the landing page and the sign-in forms — request nothing from anybody else. Fonts, images and the 3D model on the landing page are all served from Collabify's own address, so no other company learns your IP address by your visiting it.`,
        },
        {
          kind: 'p',
          text: `Once you sign in, the app talks to Supabase, which is the database and sign-in service it runs on. If you signed in with Google and kept the picture Google gave, that picture is loaded from Google's servers, so Google sees a request for it. Uploading your own photo in Settings replaces it and ends that.`,
        },
        {
          kind: 'p',
          text: `Who these services are and what reaches them is set out in the [privacy policy](/privacy#who-can-see-it).`,
        },
      ],
    },

    {
      id: 'no-banner',
      heading: `Why there is no banner`,
      blocks: [
        {
          kind: 'p',
          text: `A consent banner exists to ask permission for storage that is not necessary — the tracking and advertising kind. Collabify has none, and the four keys above are what the site needs to function, so there is nothing to ask about. Showing a banner anyway would ask you to agree to nothing, and teach you to click through the ones that matter elsewhere.`,
        },
        {
          kind: 'p',
          text: `If Collabify ever stores something that is not necessary, this notice changes first and you will be asked before it is written.`,
        },
      ],
    },

    {
      id: 'controlling-it',
      heading: `Clearing it`,
      blocks: [
        {
          kind: 'p',
          text: `Signing out clears the session and the attempt counters. Your browser's site-data settings clear everything for a site, including the two preferences. Private browsing keeps nothing after the window closes, and Collabify works normally in it — you will just sign in every time.`,
        },
        {
          kind: 'p',
          text: `On a shared or lab machine, sign out rather than closing the tab.`,
        },
      ],
    },

    {
      id: 'changes',
      heading: `Changes`,
      blocks: [
        {
          kind: 'p',
          text: `This is version 2026-09-08, effective 8 September 2026.`,
        },
      ],
    },
  ],
}
