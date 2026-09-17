/** Sample-only data. Consumers replace these fixtures with their own providers. */
export const forecast = [
  { day: "Fri", high: 70, low: 57, condition: "Sunny", icon: "sun" },
  {
    day: "Sat",
    high: 68,
    low: 56,
    condition: "Partly cloudy",
    icon: "cloud-sun",
  },
  { day: "Sun", high: 64, low: 55, condition: "Cloudy", icon: "cloud" },
  { day: "Mon", high: 63, low: 54, condition: "Light rain", icon: "rain" },
  {
    day: "Tue",
    high: 67,
    low: 55,
    condition: "Partly cloudy",
    icon: "cloud-sun",
  },
] as const;

/** A headline can disclose its evidence locally or link to a verified source. */
export type Headline = {
  id: string;
  source: string;
  title: string;
  summary: string;
  image: string;
};
const photo = (id: string, width = 700) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=85`;
export const headlines: Headline[] = [
  {
    id: "city",
    source: "The Daily · Cities",
    title: "A little more room for a greener city",
    summary:
      "Pocket parks, slower streets, and shared gardens can make everyday city life feel a little closer to nature.",
    image: photo("photo-1518005020951-eccb494ad742", 240),
  },
  {
    id: "design",
    source: "The Journal · Design",
    title: "The quiet return of making things by hand",
    summary:
      "Ceramicists, furniture makers, and small studios are finding new possibilities in familiar materials.",
    image: photo("photo-1490312278390-ab64016e0aa9", 240),
  },
  {
    id: "travel",
    source: "Field Notes · Travel",
    title: "Taking the scenic route, one train at a time",
    summary:
      "Make the journey part of the destination, from coastal railways to weekend trips closer to home.",
    image: photo("photo-1473448912268-2022ce9509d8", 240),
  },
];

/** Email previews contain no account credentials or sending behavior. */
export type EmailPreview = {
  id: string;
  initials: string;
  sender: string;
  time: string;
  subject: string;
  preview: string;
  body: string;
  unread: boolean;
};
export const emails: EmailPreview[] = [
  {
    id: "mia",
    initials: "MC",
    sender: "Mia Chen",
    time: "9:41 AM",
    subject: "A few ideas for Friday",
    preview: "Pulled together a few references for our…",
    body: "Pulled together a few references for our Friday design session. I’d love to explore the softer shapes and the simpler type hierarchy together. See you there!",
    unread: true,
  },
  {
    id: "alex",
    initials: "AR",
    sender: "Alex Rivera",
    time: "9:12 AM",
    subject: "See you at the studio",
    preview: "Coffee’s on me. Same place, a little…",
    body: "Coffee’s on me. Same place, a little earlier this week. I’ll bring the prints so we can take a look in person.",
    unread: true,
  },
  {
    id: "field",
    initials: "FN",
    sender: "Field Notes",
    time: "8:30 AM",
    subject: "Something worth keeping",
    preview: "This week: objects with a story to tell.",
    body: "This week: objects with a story to tell. A collection of everyday things that get better with time, from a favorite notebook to a well-used chair.",
    unread: false,
  },
];

/** Photos retain their source URLs and descriptive alternative text. */
export const moodPhotos = [
  {
    src: photo("photo-1600210492486-724fe5c67fb0"),
    alt: "Sunlight and warm neutral tones in a living room",
  },
  {
    src: photo("photo-1490312278390-ab64016e0aa9"),
    alt: "Pastel ceramic vessels and a flowering branch on a table",
  },
  {
    src: photo("photo-1518837695005-2083093ee35b"),
    alt: "Soft blue ocean waves meeting the shore",
  },
  {
    src: photo("photo-1441974231531-c6227db76b6e"),
    alt: "Sunlight filtering through a green forest",
  },
];

export const albumArt = photo("photo-1470252649378-9c29740c9fa8");
export const attendees = [
  { name: "Mia Chen", initials: "MC" },
  { name: "Alex Rivera", initials: "AR" },
  { name: "You", initials: "YO" },
];
export const activityDays = [
  { day: "Mon", steps: 6200 },
  { day: "Tue", steps: 8100 },
  { day: "Wed", steps: 5800 },
  { day: "Thu", steps: 6842 },
];
