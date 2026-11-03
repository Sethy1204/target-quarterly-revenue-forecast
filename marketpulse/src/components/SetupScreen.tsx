import type { ConfigResponse } from '../../shared/types';

export function SetupScreen({ config, onRetry }: { config: ConfigResponse; onRetry: () => void }) {
  return (
    <section className="panel setup" aria-labelledby="setup-h">
      <h2 id="setup-h">Connect a market-data provider</h2>
      <p>MarketPulse has no provider credentials yet, so no quotes or news are shown (nothing is simulated). Missing:</p>
      <ul>
        {config.missing.map((m) => (
          <li key={m}>
            <code>{m.split(' ')[0]}</code> {m.slice(m.indexOf(' '))}
          </li>
        ))}
      </ul>
      <ol>
        <li>
          Create free accounts: <a href="https://twelvedata.com/pricing" target="_blank" rel="noopener noreferrer">Twelve Data</a> (quotes + charts) and{' '}
          <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer">Finnhub</a> (news, earnings, market cap).
        </li>
        <li>
          In the project folder run <code>npm run setup</code> (prompts for keys and writes <code>.env</code>), or copy <code>.env.example</code> to <code>.env</code> and fill it in.
        </li>
        <li>
          Set <code>TWELVEDATA_US_TIMING</code> / <code>TWELVEDATA_TSX_TIMING</code> to what your plan actually provides (real-time, delayed or end-of-day).
        </li>
        <li>Restart the server, then click Retry.</li>
      </ol>
      <p className="muted">
        Keys stay on the server (read from <code>.env</code>) and are never sent to the browser. To explore the interface without keys, start a clearly-labelled demo with{' '}
        <code>npm run start:demo</code> — demo values are static fixtures, not market data.
      </p>
      {config.missing.length < 2 && <p>Partial configuration is fine: the dashboard will show what the configured provider supports.</p>}
      <button className="primary" onClick={onRetry}>Retry</button>
    </section>
  );
}
