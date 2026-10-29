const STEPS = [
  { title: 'Design a warehouse', text: 'Shape the floor and place racks and stations, or use the included warehouse.', action: 'Open Layouts', view: 'layouts' },
  { title: 'Configure the robot fleet', text: 'Choose 1–8 simulated robots. Four robots is a useful starting point.', action: 'Configure fleet' },
  { title: 'Train its model', text: 'Every warehouse learns its own routes before it can run. One press, a few seconds.', action: 'Open Training Lab', view: 'models' },
  { title: 'Choose navigation', text: 'Shortest path, learned routes, or a mix of both.', action: 'Choose a method' },
  { title: 'Run the simulation', text: 'Create the simulation, then press Play. Pause, step forward, and inspect virtual robots at any time.', action: 'Set up a simulation' },
  { title: 'Analyze performance', text: 'Review deliveries, order times, and waits. Compare navigation methods on the same orders.', action: 'Open History & Compare', view: 'history' },
];

export function GettingStarted({ onNavigate, onConfigure }) {
  return (
    <section className="start-guide" aria-labelledby="start-guide-title">
      <div className="start-guide-intro"><span className="eyebrow">Your first simulation</span><h2 id="start-guide-title">Test warehouse ideas before changing operations</h2><p>RoboWare simulates robots picking, packing, and shipping orders in a virtual warehouse so you can explore layouts and navigation choices.</p><p className="simulation-notice">Simulation only. RoboWare does not connect to or control physical robots.</p></div>
      <div className="start-guide-actions"><button type="button" className="clay-btn clay-btn-accent" onClick={onConfigure}>Set up a simulation</button><span>Included warehouse available · four virtual robots</span></div>
      <ol className="start-guide-steps">{STEPS.map((step, index) => <li key={step.title}>
        <span className="guide-step-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{step.title}{step.optional && <span className="badge">Optional</span>}</h3><p>{step.text}</p><button type="button" className="guide-action" onClick={() => step.view ? onNavigate(step.view) : onConfigure()}>{step.action} →</button></div>
      </li>)}</ol>
    </section>
  );
}
