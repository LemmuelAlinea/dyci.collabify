import { useEffect, useRef, useState } from "react";
import { BlueprintField, Glow, Kicker, Shell } from "./parts";

/**
 * How it runs, as a film.
 *
 * This section used to be a sticky panel that stepped a mock board through six
 * states as you scrolled. The launch film shows the product doing the same
 * job, so the mock gives way to the film. The list on the left is the film's
 * chapters: it follows playback, and choosing one seeks to it. Nothing plays
 * until the visitor presses play, and the file is not fetched before then.
 *
 * The captions track carries the voice-over, so the section still reads with
 * the sound off. The film is 80 seconds; the chapter times below are where each
 * part opens.
 */

const SRC = "/video/collabify-film.mp4";
const POSTER = "/video/collabify-film-poster.jpg";
const CAPTIONS = "/video/collabify-film.en.vtt";

// Start times are where each part opens in the film.
const CHAPTERS = [
  {
    at: 0,
    title: "Meet Collabify",
    body: "The project workspace where classes and teams plan, build and finish together.",
  },
  {
    at: 7,
    title: "Make it yours",
    body: "Your own colors for banners, statuses, the sidebar and progress, in light or dark.",
  },
  {
    at: 15,
    title: "Two spaces",
    body: "An educational space for classes and a work space for teams.",
  },
  {
    at: 19,
    title: "Build from the syllabus",
    body: "Professors pick the weeks, take a suggested name and let AI draft the brief and rubric.",
  },
  {
    at: 27,
    title: "Plan by voice",
    body: "Record in a discussion. Collabify transcribes it, saves a discussion file and drafts the tasks. Nothing is added until you choose.",
  },
  {
    at: 36,
    title: "Board, files, hand-in",
    body: "Tasks sit on one board. Files go from draft to review to Main. The group hands in and the professor accepts.",
  },
  {
    at: 48,
    title: "Start from a template, or blank",
    body: "Add your own fields, upload files and share them with the team.",
  },
  {
    at: 59,
    title: "Teams and positions",
    body: "Set up teams and every member's position, so the project fits the people on it.",
  },
  {
    at: 67,
    title: "Summarize long files",
    body: "Open a long paper on Main and get its key points in one step.",
  },
];

function format(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function Workflow() {
  const video = useRef<HTMLVideoElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(80);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onTime = () => setTime(v.currentTime);
    const onMeta = () => setDuration(v.duration || 80);
    const onPlay = () => {
      setStarted(true);
      setPlaying(true);
    };
    const onPause = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onPause);
    };
  }, []);

  // The chapter whose start the playhead has passed. Before the first chapter
  // (the opening line) nothing is lit.
  const active = started
    ? CHAPTERS.reduce((a, c, i) => (time >= c.at - 0.05 ? i : a), -1)
    : -1;

  // On a phone the chapters are a strip under the film. Keep the lit one in
  // view by moving the strip itself, never the page.
  useEffect(() => {
    const row = strip.current;
    const chip = row?.children[Math.max(active, 0)] as HTMLElement | undefined;
    if (!row || !chip) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollTo({
      left: chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2,
      behavior: reduce ? "auto" : "smooth",
    });
  }, [active]);

  const play = () => {
    void video.current?.play();
  };
  const seek = (at: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = at;
    void v.play();
  };

  return (
    <section id="how" className="relative bg-white text-amber-50">
      <div className="relative overflow-hidden bg-navy-950 py-20 sm:py-24 lg:py-28">
        <BlueprintField />
        <Glow corner="right" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-amber-50/10"
        />
        <Shell className="relative">
          {/* Phone order is heading, film, chapters. From lg up the film spans
              both rows on the right. */}
          <div className="grid gap-x-12 gap-y-8 lg:grid-cols-12 lg:gap-y-7">
            {/* --------------------------------------------------- heading */}
            <div className="lg:col-span-5 lg:row-start-1 lg:self-end">
              <Kicker>How it runs</Kicker>
              <h2 className="mt-5 font-display text-[clamp(28px,4.2vw,46px)] leading-[1.08] font-bold tracking-[-0.04em] text-amber-50">
                Watch a chat become
                <br />
                <span className="text-amber-300">the plan.</span>
              </h2>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-amber-50/60">
                Eighty seconds, from the first conversation to a project handed
                in. Pick a chapter to jump to it.
              </p>
            </div>
            {/* ---------------------------------------------------- player */}
            <div className="lg:col-span-7 lg:col-start-6 lg:row-span-2 lg:row-start-1 lg:self-center">
              <div className="relative overflow-hidden rounded-[22px] border border-amber-50/12 bg-black shadow-[0_34px_100px_-24px_rgb(0_0_0_/_0.85)]">
                <video
                  ref={video}
                  className="block aspect-video w-full bg-black"
                  poster={POSTER}
                  preload="none"
                  controls={started}
                  playsInline
                >
                  <source src={SRC} type="video/mp4" />
                  <track
                    kind="captions"
                    src={CAPTIONS}
                    srcLang="en"
                    label="English"
                    default
                  />
                </video>

                {!started && (
                  <button
                    type="button"
                    onClick={play}
                    aria-label="Play the Collabify film"
                    className="group absolute inset-0 grid place-items-center focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-amber-300"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-0 bg-gradient-to-t from-navy-950/70 via-navy-950/10 to-transparent"
                    />
                    <span className="relative grid h-[76px] w-[76px] place-items-center rounded-full bg-amber-400 text-navy-950 shadow-[0_18px_44px_-10px_rgb(240_180_41_/_0.75)] transition-transform duration-300 group-hover:scale-[1.06] sm:h-[92px] sm:w-[92px]">
                      <svg
                        viewBox="0 0 24 24"
                        className="ml-1 h-8 w-8 sm:h-9 sm:w-9"
                        fill="currentColor"
                        aria-hidden
                      >
                        <path d="M7 4.5v15a1 1 0 0 0 1.52.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5Z" />
                      </svg>
                    </span>
                    <span className="absolute bottom-4 left-5 font-mono text-[11px] tracking-[0.18em] text-amber-50/85 uppercase">
                      Play · {format(duration)} · sound on
                    </span>
                  </button>
                )}
              </div>

              <p
                className="mt-3 px-1 font-mono text-[10px] tracking-[0.16em] text-amber-50/40 uppercase"
                aria-live="off"
              >
                {started
                  ? playing
                    ? "Playing"
                    : "Paused"
                  : "Collabify in 80 seconds"}
                {started && ` · ${format(time)} / ${format(duration)}`}
              </p>
            </div>
            {/* ------------------------------------------------- chapters */}
            <div className="min-w-0 lg:col-span-5 lg:row-start-2">
              {/* Phone and tablet: a strip of parts and the lit part's line,
                  right under the film, so nothing pushes the page down. */}
              <div className="lg:hidden">
                <div
                  ref={strip}
                  className="relative -mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] md:-mx-8 md:px-8 [&::-webkit-scrollbar]:hidden"
                >
                  {CHAPTERS.map((c, i) => {
                    const on = i === active;
                    return (
                      <button
                        key={c.title}
                        type="button"
                        onClick={() => seek(c.at)}
                        aria-current={on ? "true" : undefined}
                        className={`flex shrink-0 snap-center items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium whitespace-nowrap transition-[background-color,border-color,color] duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ${
                          on
                            ? "border-amber-400 bg-amber-400 text-navy-950"
                            : "border-amber-50/14 bg-white/[0.05] text-amber-50/70"
                        }`}
                      >
                        <span
                          className={`font-mono text-[10px] tracking-wide ${
                            on ? "text-navy-950/70" : "text-amber-50/40"
                          }`}
                        >
                          {format(c.at)}
                        </span>
                        {c.title}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 min-h-[4.5rem] px-0.5 text-[14px] leading-relaxed text-amber-50/65">
                  {active >= 0 ? CHAPTERS[active].body : "Pick a part to jump to it."}
                </p>
              </div>

              {/* From lg up the parts are a list beside the film. */}
              <ol className="hidden space-y-1.5 lg:block">
                {CHAPTERS.map((c, i) => {
                  const on = i === active;
                  return (
                    <li key={c.title}>
                      <button
                        type="button"
                        onClick={() => seek(c.at)}
                        aria-current={on ? "true" : undefined}
                        className={`group flex w-full gap-3.5 rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color,color] duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ${
                          on
                            ? "border-amber-50/14 bg-white/[0.07] text-amber-50"
                            : "border-transparent text-amber-50/55 hover:bg-white/[0.04] hover:text-amber-50"
                        }`}
                      >
                        <span
                          className={`grid h-7 w-14 shrink-0 place-items-center rounded-lg font-mono text-[10px] tracking-wide transition-colors duration-300 ${
                            on
                              ? "bg-amber-400 font-bold text-navy-950"
                              : "bg-white/[0.05] text-amber-50/45"
                          }`}
                        >
                          {format(c.at)}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-display text-[16px] font-semibold tracking-[-0.015em]">
                            {c.title}
                          </span>
                          <span
                            className="grid transition-[grid-template-rows,opacity] duration-300"
                            style={{
                              gridTemplateRows: on ? "1fr" : "0fr",
                              opacity: on ? 1 : 0,
                            }}
                          >
                            <span className="overflow-hidden text-[13px] leading-relaxed text-amber-50/60">
                              <span className="block pt-1.5">{c.body}</span>
                            </span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </Shell>
      </div>
    </section>
  );
}
