import { samples } from '@cloudverse/samples';

// Scaffold only: proves the app builds and can load bundled samples in a
// browser. The real Defense Lab UI arrives in Task 11.
const root = document.getElementById('app');
if (root) {
  const heading = document.createElement('h1');
  heading.textContent = 'CloudVerse Defense Lab';

  const intro = document.createElement('p');
  intro.textContent = 'Security investigation and simulated remediation. Sample scenarios bundled with this app:';

  const list = document.createElement('ul');
  for (const sample of samples) {
    const item = document.createElement('li');
    item.textContent = `${sample.title}: ${sample.description}`;
    list.append(item);
  }

  root.replaceChildren(heading, intro, list);
}
