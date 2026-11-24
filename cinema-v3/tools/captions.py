import os, wave

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LINES = [
    (0.45, "Meet Collabify. The project workspace where classes and teams plan, build, and finish together."),
    (7.4, "Make it yours. Choose every color: the banner, the navigation, even your status colors. Light, or dark."),
    (15.3, "Two spaces. One for the classroom. One for the workplace."),
    (19.4, "In the educational space, professors build projects from the syllabus. Suggestions name them, and AI drafts the brief."),
    (27.4, "Then students plan by voice. Collabify transcribes the discussion, and drafts the tasks. Nothing is added until they choose."),
    (36.2, "The board shows everyone's progress."),
    (39.3, "Files move through drafts, commits, and approval, before they reach Main."),
    (44.2, "Then the group hands in, and the professor reviews and accepts."),
    (48.2, "In the work space, pick a template, or start blank."),
    (52.3, "Add your own fields. Upload and share files. Shape the project to your team."),
    (59.4, "Then set up your team, and every member's position. Everything, tailored to how you work."),
    (67.4, "Papers too long? Summarize any file on Main."),
    (74.2, "Collabify. Work together, build better."),
]


def ts(t):
    h, r = divmod(t, 3600)
    m, s = divmod(r, 60)
    return "%02d:%02d:%06.3f" % (h, m, s).replace('.', ',') if False else "%02d:%02d:%02d,%03d" % (h, m, int(s), round((s - int(s)) * 1000))


out = []
for i, (t, text) in enumerate(LINES):
    w = wave.open(os.path.join(ROOT, 'audio', 'vo', 'v%02d.wav' % i))
    d = w.getnframes() / w.getframerate()
    out.append("%d\n%s --> %s\n%s\n" % (i + 1, ts(t), ts(t + d), text))
open(os.path.join(ROOT, 'captions.srt'), 'w', encoding='utf-8').write("\n".join(out))
print('captions.srt', len(out))
