import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        terminal: {
          green: "#00ff41",
          "green-bright": "#39ff14",
          "green-dim": "#00ff00",
          cyan: "#00ffff",
          "cyan-bright": "#00d9ff",
          black: "#000000",
          "dark-green": "#001100",
          "darker-green": "#000800",
        },
        steampunk: {
          brass: "#B87333",
          "brass-bright": "#CD7F32",
          "brass-dim": "#8B6914",
          copper: "#B87333",
          "copper-bright": "#D2691E",
          bronze: "#8C7853",
          "aged-paper": "#F5E6D3",
          "aged-cream": "#E8D5B7",
          "dark-wood": "#2D1B0E",
          "wood-brown": "#3E2723",
          burgundy: "#8B4513",
          "burgundy-dark": "#654321",
          olive: "#556B2F",
          "olive-bright": "#6B8E23",
        },
        grey: {
          "steel": "#2C2C2C",
          "iron": "#3A3A3A",
          "slate": "#4A4A4A",
          "charcoal": "#1A1A1A",
          "smoke": "#5A5A5A",
          "ash": "#6B6B6B",
        },
        severity: {
          critical: "#ff0040",
          high: "#ff6b00",
          moderate: "#ffd700",
          low: "#00ff41"
        }
      },
      fontFamily: {
        mono: ["'Courier New'", "Courier", "monospace"],
        terminal: ["'Courier New'", "Courier", "monospace"],
      },
      boxShadow: {
        "terminal": "0 0 10px rgba(0, 255, 65, 0.3), inset 0 0 20px rgba(0, 255, 65, 0.1)",
        "terminal-glow": "0 0 20px rgba(0, 255, 65, 0.5)",
      },
      animation: {
        "pulse-glow": "pulse-glow 2s ease-in-out",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 20px rgba(0, 255, 65, 0.5)" },
          "50%": { boxShadow: "0 0 40px rgba(0, 255, 65, 0.8), 0 0 60px rgba(0, 255, 65, 0.4)" },
        }
      }
    }
  },
  plugins: []
};

export default config;
