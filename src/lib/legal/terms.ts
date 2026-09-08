import { PRIVACY_CONTACT } from './contact'
import type { LegalDoc } from './types'

/**
 * The terms of use.
 *
 * Kept deliberately short. This is a coursework tool inside one college, not a
 * consumer service, so most of what a commercial terms document exists to do —
 * subscriptions, refunds, arbitration, indemnities against the world — has no
 * subject here. What is left is the part that actually matters to a student:
 * who owns the work they hand in, what happens to their account, and what the
 * software will and will not do.
 *
 * Acceptance of these terms is recorded separately from consent to the privacy
 * policy. Agreeing to a contract and consenting to the processing of sensitive
 * information are different acts under RA 10173 §3(b), and bundling them into
 * one tick is exactly the failure the "specific" requirement names.
 */
export const TERMS: LegalDoc = {
  slug: 'terms',
  title: `Terms of use`,
  kicker: `The rules of the account`,
  summary: `What you agree to when you use Collabify, and what you keep.`,
  version: `2026-09-08`,
  effective: `2026-09-08`,
  sections: [
    {
      id: 'what-this-is',
      heading: `What Collabify is`,
      blocks: [
        {
          kind: 'p',
          text: `Collabify is a coursework system for BSIT classes at Dr. Yanga's Colleges. It holds classes, groups, project boards, tasks, deadlines, files and conversations. It is provided by the college for its own courses and is not a public service.`,
        },
        {
          kind: 'note',
          text: `Collabify holds no grades. Nothing it shows is a grade, nothing in it is worth marks by itself, and no number it displays is your standing in a subject. Your grades are recorded wherever the college records grades.`,
        },
        {
          kind: 'p',
          text: `Using it means agreeing to what follows. If you do not agree, do not register — tell your professor, who will arrange another way to hand work in.`,
        },
      ],
    },

    {
      id: 'who-can-register',
      heading: `Who can register`,
      blocks: [
        {
          kind: 'p',
          text: `You need to be enrolled at the college, or teaching there, and be 18 or older. If you are under 18, tell your professor before registering. A parent or guardian has to consent on your behalf, and that is arranged outside the system.`,
        },
        {
          kind: 'p',
          text: `Register with your own name and an address you control. An account is yours alone: do not share the password, do not sign in as somebody else, and do not let somebody else use your session. Work submitted from your account is treated as yours.`,
        },
        {
          kind: 'p',
          text: `Whether you are a student or a professor is set by the college. Nobody can change their own role or account status — the database refuses it, not only the screens.`,
        },
      ],
    },

    {
      id: 'acceptable-use',
      heading: `Acceptable use`,
      blocks: [
        { kind: 'p', text: `Do not:` },
        {
          kind: 'list',
          items: [
            `Harass, threaten or abuse anyone in a message, a comment or a task.`,
            `Upload anything unlawful, or anything you do not have the right to share.`,
            `Upload somebody else's personal information — a class list, a screenshot of somebody's record — without their agreement.`,
            `Try to reach classes, groups, boards or conversations you were not added to, or probe the system for ways to.`,
            `Pass off somebody else's work as your own. Academic honesty rules apply here exactly as they do on paper.`,
            `Automate the site, scrape it, or run load against it.`,
            `Interfere with anybody else's work — deleting their tasks, editing their entries, taking over their boards.`,
          ],
        },
        {
          kind: 'p',
          text: `Content is not reviewed before it appears. Professors and administrators can remove anything that breaks these rules, and can suspend an account. Serious cases go to the college under its student handbook, which sits above these terms.`,
        },
      ],
    },

    {
      id: 'your-work',
      heading: `Your work stays yours`,
      blocks: [
        {
          kind: 'p',
          text: `You keep ownership of everything you write and upload — your tasks, your messages, your files, your project work. Registering does not transfer any of it to the college or to Collabify.`,
        },
        {
          kind: 'p',
          text: `You give the college permission to store your work, to show it to the people it is for — your professor, your groupmates, your class — and to keep it for as long as the retention period in the [privacy policy](/privacy) says. That permission exists only so the course can run. It does not let anyone publish your work, use it in promotional material, or license it onward.`,
        },
        {
          kind: 'p',
          text: `Work you produce for a course may still fall under the college's own rules on academic output. Those rules are separate from these terms and are not changed by them.`,
        },
      ],
    },

    {
      id: 'ai',
      heading: `The AI features`,
      blocks: [
        {
          kind: 'p',
          text: `Two things in Collabify use an AI model, and both are for professors: reading a syllabus to pull out its topics and dates, and drafting a list of tasks from a project brief. The text sent to do this is processed by Anthropic.`,
        },
        {
          kind: 'p',
          text: `No student name, address or coursework is ever sent to it. What is sent is the brief, rubric or syllabus text the professor supplies — which, in the case of a syllabus, usually carries the professor's own name and contact details.`,
        },
        {
          kind: 'p',
          text: `Everything it produces is a draft. It can be wrong, it can miss things, and it is edited before it is used. Nothing about your work is decided by it, and no professor's judgement is replaced by it.`,
        },
      ],
    },

    {
      id: 'availability',
      heading: `Availability`,
      blocks: [
        {
          kind: 'p',
          text: `Collabify is provided as it is. It runs on services the college does not operate, it can be unavailable, and it can lose data through a fault outside anybody's control. Keep your own copy of work that matters, especially near a deadline.`,
        },
        {
          kind: 'p',
          text: `A deadline missed because the site was down is a matter for your professor, who decides what to do about it. The system's record is evidence, not the decision.`,
        },
        {
          kind: 'p',
          text: `The college is not liable for indirect losses arising from use of Collabify. Nothing here limits liability that the law does not allow to be limited.`,
        },
      ],
    },

    {
      id: 'ending',
      heading: `Ending an account`,
      blocks: [
        {
          kind: 'p',
          text: `You can stop using Collabify at any time. Accounts are deactivated rather than deleted, because deleting one would take its owner's tasks, messages and files out of their groupmates' shared work. Ask ${PRIVACY_CONTACT.name} to deactivate yours.`,
        },
        {
          kind: 'p',
          text: `You can also ask for your information to be erased — see [erasure in the privacy policy](/privacy#right-erasure) for exactly what can be removed and the one thing that cannot.`,
        },
        {
          kind: 'p',
          text: `The college can suspend or end an account that breaks these rules, or when you leave the college. Records are then kept for the retention period and removed.`,
        },
      ],
    },

    {
      id: 'law',
      heading: `Law`,
      blocks: [
        {
          kind: 'p',
          text: `These terms are governed by the laws of the Republic of the Philippines. Any dispute goes to the courts of Bulacan.`,
        },
        {
          kind: 'p',
          text: `Personal information is handled under the Data Privacy Act of 2012 and is described in the [privacy policy](/privacy), which is part of these terms.`,
        },
      ],
    },

    {
      id: 'changes',
      heading: `Changes`,
      blocks: [
        {
          kind: 'p',
          text: `This is version 2026-09-08, effective 8 September 2026. Your agreement is recorded against the version you were shown.`,
        },
        {
          kind: 'p',
          text: `A correction or a clearer sentence does not need your agreement again. A change to what you are agreeing to does, and you will be asked the next time you sign in.`,
        },
        { kind: 'p', text: `Questions go to ${PRIVACY_CONTACT.name}.` },
      ],
    },
  ],
}
