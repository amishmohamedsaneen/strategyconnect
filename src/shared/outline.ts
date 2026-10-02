export type OutlineItem = {
  id: string;
  title: string;
  description: string;
};

export type Outline = {
  items: OutlineItem[];
};

export const SAMPLE_OUTLINE: Outline = {
  items: [
    { id: "a1", title: "Introduction", description: "Set context and agenda." },
    { id: "b2", title: "Market Landscape", description: "Size, growth, key segments." },
    { id: "c3", title: "Pricing Overview", description: "Headline pricing model." },
    { id: "d4", title: "Competitive Analysis", description: "How we compare to alternatives." },
    { id: "e5", title: "Pricing Details", description: "Tiers, discounts, terms." },
    { id: "f6", title: "Next Steps", description: "Owners and timeline." },
  ],
};
