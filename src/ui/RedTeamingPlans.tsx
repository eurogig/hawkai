import type { RedTeamingPlan } from "@/types";

interface RedTeamingPlansProps {
  plans: RedTeamingPlan[];
}

export default function RedTeamingPlans({ plans }: RedTeamingPlansProps) {
  if (plans.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-4 border-2 border-steampunk-brass bg-grey-charcoal p-6">
      <h3 className="text-lg font-bold text-terminal-green-bright uppercase tracking-wider">
        <span className="text-steampunk-brass">[</span>RED-TEAMING PLANS<span className="text-steampunk-brass">]</span>
      </h3>
      <p className="text-sm text-grey-ash">
        Auto-generated attack plans based on detected risky paths, frameworks, and OWASP LLM Top 10 risks.
      </p>
      
      <div className="space-y-6">
        {plans.map((plan, idx) => (
          <div
            key={plan.id}
            className="border-2 border-steampunk-brass bg-grey-iron p-4"
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold px-2 py-1 uppercase ${
                    plan.riskLevel === "critical" ? "bg-red-900 text-red-200" :
                    plan.riskLevel === "high" ? "bg-orange-900 text-orange-200" :
                    plan.riskLevel === "moderate" ? "bg-yellow-900 text-yellow-200" :
                    "bg-grey-ash text-grey-charcoal"
                  }`}>
                    {plan.riskLevel}
                  </span>
                  <span className="text-sm text-grey-ash">
                    Confidence: {Math.round(plan.confidence * 100)}%
                  </span>
                </div>
                <h4 className="text-base font-bold text-terminal-green-bright">
                  {plan.target.label}
                </h4>
                <p className="text-xs text-grey-ash mt-1">
                  <span className="text-steampunk-brass">Target:</span> {plan.target.type} - {plan.target.file}
                  {plan.target.line && `:${plan.target.line}`}
                </p>
              </div>
            </div>

            {/* Path */}
            <div className="mb-3 p-2 bg-grey-charcoal border border-steampunk-brass">
              <p className="text-xs font-bold text-steampunk-brass mb-1">Path:</p>
              <div className="text-xs text-terminal-green font-mono space-y-1">
                <div>
                  <span className="text-steampunk-brass">Source:</span> {plan.path.source.label}
                  {plan.path.source.file && (
                    <span className="text-grey-ash"> ({plan.path.source.file}{plan.path.source.line ? `:${plan.path.source.line}` : ""})</span>
                  )}
                </div>
                {plan.path.transforms.length > 0 && (
                  <div>
                    <span className="text-steampunk-brass">Transforms:</span> {plan.path.transforms.map((t, i) => (
                      <span key={i}>
                        {i > 0 && " → "}
                        {t.label}
                        {t.file && (
                          <span className="text-grey-ash"> ({t.file}{t.line ? `:${t.line}` : ""})</span>
                        )}
                      </span>
                    )).join("")}
                  </div>
                )}
                <div>
                  <span className="text-steampunk-brass">Sink:</span> {plan.path.sink.label}
                  {plan.path.sink.file && (
                    <span className="text-grey-ash"> ({plan.path.sink.file}{plan.path.sink.line ? `:${plan.path.sink.line}` : ""})</span>
                  )}
                </div>
                <div className="text-grey-ash mt-1">
                  Path ID: {plan.id}
                </div>
              </div>
            </div>

            {/* OWASP Risks */}
            {plan.risks.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-bold text-steampunk-brass mb-1">OWASP Risks:</p>
                <div className="flex flex-wrap gap-2">
                  {plan.risks.map((risk, i) => (
                    <span
                      key={i}
                      className="text-xs px-2 py-1 border border-steampunk-brass bg-grey-charcoal text-terminal-green"
                    >
                      {risk.owasp}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Frameworks & Tools */}
            {(plan.frameworks.length > 0 || plan.tools.length > 0) && (
              <div className="mb-3 flex flex-wrap gap-4 text-xs">
                {plan.frameworks.length > 0 && (
                  <div>
                    <span className="text-steampunk-brass font-bold">Frameworks:</span>{" "}
                    <span className="text-terminal-green">{plan.frameworks.join(", ")}</span>
                  </div>
                )}
                {plan.tools.length > 0 && (
                  <div>
                    <span className="text-steampunk-brass font-bold">Tools:</span>{" "}
                    <span className="text-terminal-green">{plan.tools.join(", ")}</span>
                  </div>
                )}
              </div>
            )}

            {/* Suggested Attacks */}
            {plan.attacks.length > 0 && (
              <div>
                <p className="text-xs font-bold text-steampunk-brass mb-2">
                  Suggested Attacks ({plan.attacks.length}):
                </p>
                <ul className="space-y-2">
                  {plan.attacks.map((attack, i) => (
                    <li key={i} className="text-xs">
                      <div className="flex items-start gap-2">
                        <span className={`px-2 py-0.5 text-xs font-bold uppercase flex-shrink-0 ${
                          attack.priority === "critical" ? "bg-red-900 text-red-200" :
                          attack.priority === "high" ? "bg-orange-900 text-orange-200" :
                          attack.priority === "moderate" ? "bg-yellow-900 text-yellow-200" :
                          "bg-grey-ash text-grey-charcoal"
                        }`}>
                          {attack.priority}
                        </span>
                        <div className="flex-1">
                          <p className="font-bold text-terminal-green">{attack.title}</p>
                          <p className="text-grey-ash mt-0.5">{attack.description}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

