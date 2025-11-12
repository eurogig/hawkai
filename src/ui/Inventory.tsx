import type { Inventory } from "@/types";

interface InventoryProps {
  inventory: Inventory;
}

const CARDS: Array<{ key: keyof Inventory; label: string; description: string }> = [
  { key: "sdks", label: "SDKs", description: "Client libraries and SDKs detected" },
  { key: "models", label: "Models", description: "Referenced models" },
  { key: "frameworks", label: "Frameworks", description: "Agent frameworks and orchestration" },
  { key: "tools", label: "Tools", description: "Tools or capabilities exposed" }
];

function InventoryGrid({ inventory }: InventoryProps) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {CARDS.map((card) => {
        const values = inventory[card.key];
        return (
          <article key={card.key} className="border-2 border-steampunk-brass bg-grey-charcoal p-6 font-mono shadow-md">
            <h3 className="text-sm font-bold text-terminal-green-bright uppercase tracking-wider">
              <span className="text-steampunk-brass">[</span>{card.label}<span className="text-steampunk-brass">]</span>
            </h3>
            <p className="mt-1 text-xs text-grey-ash">{card.description}</p>
            <ul className="mt-4 flex flex-wrap gap-2 text-xs text-terminal-green">
              {values.length === 0 ? <li className="text-grey-ash">None detected</li> : null}
              {values.map((value) => (
                <li
                  key={value}
                  className="border-2 border-steampunk-brass bg-grey-iron px-3 py-1 text-steampunk-brass font-bold uppercase"
                >
                  {value}
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </section>
  );
}

export default InventoryGrid;
