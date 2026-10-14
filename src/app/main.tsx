import { render } from 'preact';
import './install';
import { App } from './App';
import './styles.css';

render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(__BASE__ + 'sw.js', { scope: __BASE__ }).catch(() => undefined);
}
