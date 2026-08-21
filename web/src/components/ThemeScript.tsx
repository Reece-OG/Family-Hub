// Inline theme bootstrap — runs before React mounts so we never flash the wrong theme.
export function ThemeScript() {
  const code = `
    (function(){
      try {
        var stored = localStorage.getItem('familyhub-theme');
        var sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        var useDark = stored ? stored === 'dark' : sysDark;
        document.documentElement.classList.toggle('dark', useDark);
      } catch (e) {}
    })();
  `;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
