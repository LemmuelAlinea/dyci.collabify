import { PRIVACY_CONTACT, REGULATOR, SCHOOL_DPO } from './contact'
import type { LegalDoc } from './types'

/**
 * The privacy policy.
 *
 * Sectioned to follow the nine things RA 10173 §16(a) says a data subject must
 * be told before their information enters a system, so somebody checking this
 * against the Act can work down it rather than hunting.
 *
 * Every claim here was checked against the schema and the code rather than
 * written from a template. Where the honest answer is uncomfortable — a public
 * avatar bucket, a classmate who can read your address through the API, an
 * audit log nobody can delete — it says so. A policy that describes a better
 * system than the one running is worth less than no policy, because it is a
 * written commitment the software will fail.
 *
 * Bump `version` for any change to the wording, and add the new version to
 * `legal_versions` in the database or consent to it will be rejected. Only a
 * material change — a new recipient, a new purpose, a new category of data —
 * should ask people to agree again.
 */
export const PRIVACY: LegalDoc = {
  slug: 'privacy',
  title: `Privacy policy`,
  kicker: `How your information is handled`,
  summary: `What Collabify holds about you, who can see it, how long it is kept, and what you can ask for.`,
  version: `2026-09-08`,
  effective: `2026-09-08`,
  sections: [
    {
      id: 'who-is-responsible',
      heading: `Who is responsible`,
      blocks: [
        {
          kind: 'p',
          text: `Collabify is a coursework system used by BSIT classes at Dr. Yanga's Colleges. Under the Data Privacy Act of 2012 the college is the personal information controller — it decides what is collected and why, and it is accountable for it.`,
        },
        {
          kind: 'p',
          text: `${PRIVACY_CONTACT.name} receives privacy requests on the college's behalf. They are not the controller and their answer is not the college's last word: you can take anything further to the college's Data Protection Officer, ${SCHOOL_DPO.name}, and beyond that to the ${REGULATOR.name}.`,
        },
        {
          kind: 'p',
          text: `You can ask for any of this through [the request form](/privacy/request) once you are signed in.`,
        },
      ],
    },

    {
      id: 'sensitive-information',
      heading: `Why this asks for consent specifically`,
      blocks: [
        {
          kind: 'p',
          text: `The Data Privacy Act treats education information the same way it treats health and religion: as sensitive personal information. Almost everything Collabify holds is about your coursework, so almost all of it falls in that category.`,
        },
        {
          kind: 'p',
          text: `That is why registration asks you to agree to this policy in its own checkbox, separately from the terms of use. Sensitive information needs consent that is specific and recorded, not consent implied by carrying on using the site.`,
        },
        {
          kind: 'note',
          text: `Collabify holds no grades. There is no grade column anywhere in it, and nothing in it is your grade. Your grades live wherever the college keeps them.`,
        },
      ],
    },

    {
      id: 'what-is-held',
      heading: `What Collabify holds`,
      blocks: [
        { kind: 'p', text: `Three kinds of thing, and only the third usually surprises people.` },
        {
          kind: 'p',
          text: `**What you give it.** Your first, middle and last name, your email address, whether you are a student or a professor, a profile photo if you upload one, and your light or dark theme preference. Your password is handled by the sign-in service and Collabify never sees or stores it. If you sign in with Google, Google gives Collabify your email address, your name and your profile picture, and nothing else.`,
        },
        {
          kind: 'p',
          text: `**What you write.** Messages in class, group and one-to-one conversations. Comments on tasks. Work log entries — the minutes you record, the note you write, and the date. The reason you give when you ask for a task to be reassigned. Announcements. Poll votes, which are recorded against your name and are not anonymous. Task titles and details. Files you upload to a task, a conversation or a class.`,
        },
        {
          kind: 'p',
          text: `**What the system records without you typing it.** When you joined a class and when you left it, and who removed you. Which group you were put in and who put you there. Which tasks you claimed and when. A per-task activity trail of what you did to it. Whether a task was finished late. The professor's written decision and feedback when work is handed in. A snapshot of your name kept in the administrative log when your account or a class changes.`,
        },
        {
          kind: 'note',
          text: `Notifications keep a short preview of whatever triggered them. If the trigger was a private message, a line of that message is copied into the notification. Only you can read your own notifications, but the copy exists.`,
        },
        {
          kind: 'p',
          text: `Two more things are held by the services underneath Collabify rather than by Collabify itself. The sign-in service records the IP address and browser of each sign-in, and the host that serves the pages keeps request logs containing IP addresses, browsers and referring pages. Collabify's own tables store no IP addresses at all.`,
        },
      ],
    },

    {
      id: 'why-it-is-held',
      heading: `What it is used for`,
      blocks: [
        {
          kind: 'list',
          items: [
            `Running your classes — enrolment, groups, projects, boards, deadlines and handing work in.`,
            `Showing a professor how their classes are progressing, so they can act before a deadline turns into a problem.`,
            `Sending you notifications and the emails that confirm your address or reset your password.`,
            `Keeping an administrative record of account and class changes, so a mistake can be traced and undone.`,
            `Protecting the system — throttling repeated sign-in attempts and repeated uploads.`,
          ],
        },
        {
          kind: 'p',
          text: `It is not used for advertising. It is not sold, and it is not shared with anyone outside the list below.`,
        },
      ],
    },

    {
      id: 'profiling',
      heading: `Measurements about you`,
      blocks: [
        {
          kind: 'p',
          text: `Collabify works some things out about you rather than being told them, which the Data Privacy Act calls profiling and gives you a specific right to object to.`,
        },
        {
          kind: 'table',
          head: [`What is worked out`, `Who can see it`],
          rows: [
            [`The last time you did anything on a board`, `Your professor`],
            [`The share of a board's work you are holding, and the share you have finished`, `Your professor, and you`],
            [`Whether one person is carrying a group, and who that is`, `Your professor`],
            [`Whether you are in no group, or holding no tasks`, `Your professor`],
            [`Whether a board has stopped moving, and for how long`, `Your professor`],
            [`Counts of your held, finished and late tasks across a class`, `Your professor`],
          ],
        },
        {
          kind: 'p',
          text: `Three things are true about all of it. Your classmates never see any of it. None of it is a grade, and Collabify holds no grades. And nothing is decided automatically — a professor reads it and makes their own decision.`,
        },
        {
          kind: 'p',
          text: `You can object to being measured this way. See [your rights](/privacy#your-rights) — in practice it means asking your professor not to use these measures for you, because there is no switch for it in the app.`,
        },
      ],
    },

    {
      id: 'who-can-see-it',
      heading: `Who can see it`,
      blocks: [
        {
          kind: 'p',
          text: `**Inside the college.** Your professor sees everything in the classes they teach. Your groupmates see the boards, tasks, comments, work log entries and conversations you share with them. Your classmates see your name and photo. A program administrator sees account records and counts, but not the content of anyone's coursework.`,
        },
        {
          kind: 'note',
          text: `Your email address is more visible than the screens suggest. Collabify's screens show classmates only your name and photo, but the underlying data interface will return your email address, your role and your account status to anyone in a class with you who asks it directly. This is a known limitation of how permissions are currently written, we are telling you rather than leaving you to discover it, and narrowing it is planned work.`,
        },
        {
          kind: 'p',
          text: `**Outside the college.** Five services process information as part of running Collabify:`,
        },
        {
          kind: 'table',
          head: [`Service`, `What reaches it`],
          rows: [
            [
              `Supabase — the database, sign-in, file storage`,
              `Everything above, plus the IP address and browser of each sign-in`,
            ],
            [`Vercel — serves the pages`, `Request logs: IP address, browser, referring page`],
            [`Brevo — sends the email`, `The address of every recipient, and the link in the message`],
            [
              `Google — only if you sign in with Google`,
              `The sign-in request. Google returns your address, name and picture`,
            ],
            [
              `Anthropic — the assistant that reads a syllabus and drafts tasks`,
              `The project brief, rubric and syllabus text a professor sends it. No student names or addresses are ever sent`,
            ],
          ],
        },
        {
          kind: 'note',
          text: `If you are a professor: the syllabus file you upload is sent to Anthropic in full when you use "read with AI". Syllabus documents usually carry your name, your department and your office hours, so that is your own personal information leaving the college's systems.`,
        },
        {
          kind: 'p',
          text: `These services process information outside the Philippines. Under section 21 of the Act the college stays accountable for what they do with it.`,
        },
      ],
    },

    {
      id: 'photos',
      heading: `Your profile photo`,
      blocks: [
        {
          kind: 'p',
          text: `Every other file in Collabify — task attachments, class files, anything sent in a conversation — is private and reachable only through a link that expires after ten minutes.`,
        },
        {
          kind: 'note',
          text: `Profile photos are the exception. A photo you upload is stored in a public location: anyone who has its link can open it, whether or not they are signed in or have an account, and the link does not expire. Changing your photo now deletes the previous one, so an old picture does not stay reachable. Making these private is planned work. Until it is done, do not upload a photo you would not put on a public page.`,
        },
      ],
    },

    {
      id: 'how-long',
      heading: `How long it is kept`,
      blocks: [
        {
          kind: 'p',
          text: `Coursework records are kept for the length of the programme plus one year — about five years — and then removed. That covers your whole enrolment and leaves room for anything disputed afterwards.`,
        },
        {
          kind: 'p',
          text: `Nothing is deleted automatically before then, and some things are archived rather than erased so they can be put back. A class that ends is archived. A student removed from a class keeps a record of having been in it, so a mistaken removal can be undone. A deleted message leaves a marker saying a message was removed, though its text is blanked and any attachment is destroyed straight away.`,
        },
        {
          kind: 'p',
          text: `Accounts are deactivated rather than deleted, because a deleted account would take its owner's tasks, messages and files out of their groupmates' shared work with it. You can still ask for erasure — see below.`,
        },
        {
          kind: 'note',
          text: `The administrative log is the one thing that cannot be edited or deleted by anybody, including administrators. It records who changed an account or a class and when. A log that its own subject can rewrite would be worthless, which is the point of it. It is covered by the same retention period as everything else.`,
        },
      ],
    },

    {
      id: 'your-rights',
      heading: `Your rights`,
      blocks: [
        {
          kind: 'p',
          text: `The Data Privacy Act gives you these. Ask for any of them through [the request form](/privacy/request), or by writing to ${PRIVACY_CONTACT.name}. A request is acknowledged within five working days and answered within fifteen. If more time is genuinely needed you will be told why.`,
        },
      ],
    },
    {
      id: 'right-informed',
      heading: `To be informed`,
      blocks: [
        {
          kind: 'p',
          text: `To know that your information is being collected and what happens to it. This notice and the consent shown when you register are how that is done.`,
        },
      ],
    },
    {
      id: 'right-access',
      heading: `To access`,
      blocks: [
        {
          kind: 'p',
          text: `To be given a copy of what is held about you. There is no download button; ask and a copy is produced for you.`,
        },
        {
          kind: 'note',
          text: `One thing is withheld. When somebody asks for one of your tasks to be reassigned they must write a reason, and that reason is shown only to the professor and its author. Giving it to you would disclose another student's personal information, so it is not included in a copy. Your right of access does not extend to information that is also somebody else's.`,
        },
      ],
    },
    {
      id: 'right-object',
      heading: `To object`,
      blocks: [
        {
          kind: 'p',
          text: `To object to how your information is used, including the measurements described above. Objecting to those means asking your professor to stop relying on them for you.`,
        },
        {
          kind: 'p',
          text: `Some processing cannot be objected to while you keep the account, because it is what makes you a member of a class. Objecting to that means closing the account.`,
        },
      ],
    },
    {
      id: 'right-rectification',
      heading: `To correct`,
      blocks: [
        {
          kind: 'p',
          text: `Your name and photo you can change yourself in Settings. Your email address and your role have to be asked for — nobody can change their own role or account status, which is enforced by the database and not only by the screens.`,
        },
        {
          kind: 'p',
          text: `Something written about you by somebody else is corrected by asking. An entry in the administrative log is never edited; a correction is recorded alongside it.`,
        },
      ],
    },
    {
      id: 'right-erasure',
      heading: `To erase or block`,
      blocks: [
        {
          kind: 'p',
          text: `To have your information removed or its use suspended. Ask, and it is done by hand — there is no self-service delete, deliberately, because deleting an account would pull its owner's contributions out of their groupmates' shared work.`,
        },
        {
          kind: 'p',
          text: `What can be removed: your profile, your messages and comments, your work log, your uploaded files and your photo. What is kept: entries in the administrative log recording that an account existed and what was changed, for the reason given above. You will be told exactly what was kept.`,
        },
      ],
    },
    {
      id: 'right-portability',
      heading: `To take it with you`,
      blocks: [
        {
          kind: 'p',
          text: `To receive what you have given in a structured, commonly used, machine-readable format. Ask and you will be sent it as a file you can open elsewhere, within the same fifteen working days.`,
        },
      ],
    },
    {
      id: 'right-damages',
      heading: `To be indemnified`,
      blocks: [
        {
          kind: 'p',
          text: `To claim compensation for damage caused by inaccurate, incomplete, outdated, false or unlawfully obtained information about you.`,
        },
      ],
    },
    {
      id: 'right-complaint',
      heading: `To complain`,
      blocks: [
        {
          kind: 'p',
          text: `If an answer does not satisfy you, take it to the college's Data Protection Officer, ${SCHOOL_DPO.name}. Beyond that you can complain to the ${REGULATOR.name} at ${REGULATOR.site}, ${REGULATOR.email}, ${REGULATOR.address}. You do not need the college's permission to do so.`,
        },
        {
          kind: 'p',
          text: `These rights pass to your heirs and assigns.`,
        },
      ],
    },

    {
      id: 'security',
      heading: `How it is protected`,
      blocks: [
        {
          kind: 'list',
          items: [
            `Every table checks who is asking before returning a row, in the database rather than only in the screens.`,
            `Files other than profile photos are private, and reached through links that expire after ten minutes.`,
            `Passwords are stored by the sign-in service, hashed. Collabify never sees them.`,
            `Nobody can change their own role or account status; the database refuses it.`,
            `The administrative log cannot be altered by anyone.`,
            `Repeated sign-in attempts and repeated uploads are throttled.`,
            `The site is served over HTTPS only, and the pages request nothing from any third party.`,
          ],
        },
      ],
    },

    {
      id: 'breach',
      heading: `If something goes wrong`,
      blocks: [
        {
          kind: 'p',
          text: `If information is lost or exposed in a way that could be used against you, the college will notify the ${REGULATOR.name} and everyone affected within 72 hours of knowing about it, as the Act requires. You will be told what happened, what was involved and what to do.`,
        },
      ],
    },

    {
      id: 'age',
      heading: `Age`,
      blocks: [
        {
          kind: 'p',
          text: `Accounts are for students aged 18 and over. If you are under 18, tell your professor before registering — a parent or guardian has to consent on your behalf, and that is arranged outside the system.`,
        },
      ],
    },

    {
      id: 'changes',
      heading: `Changes to this notice`,
      blocks: [
        {
          kind: 'p',
          text: `Each version carries a date. This is version 2026-09-08, effective 8 September 2026. Your agreement is recorded against the version you were shown, and you can see which one that was on [the request page](/privacy/request).`,
        },
        {
          kind: 'p',
          text: `A correction or a clearer sentence does not need your agreement again. A change to what is collected, why, or who receives it does, and you will be asked the next time you sign in.`,
        },
      ],
    },
  ],
}
