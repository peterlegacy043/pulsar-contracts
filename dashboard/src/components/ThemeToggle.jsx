import React, { useContext } from 'react';

/**
 * Dashboard-local ThemeToggle component.
 *
 * Mirrors frontend/src/theme/ThemeToggle.tsx but uses plain CSS classes
 * (the dashboard does not use Tailwind). The current theme may be supplied
 * via the `theme` prop or via a ThemeContext that exposes `{ theme, toggleTheme }`.
 */

// Optional context so the toggle can be dropped anywhere in the tree.
// Consumers may provide a context with shape { theme, toggleTheme }.
export const ThemeContext = React.createContext(null);

function ThemeToggle({ theme, onToggle, toggleTheme, className = '' }) {
  const context = useContext(ThemeContext);

  const currentTheme = theme ?? context?.theme ?? 'light';
  const handleToggle = onToggle ?? toggleTheme ?? context?.toggleTheme;

  const isDark = currentTheme === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  const handleClick = () => {
    if (typeof handleToggle === 'function') {
      handleToggle();
    }
  };

  return (
    <button
      type="button"
      className={`theme-toggle${className ? ` ${className}` : ''}`}
      onClick={handleClick}
      aria-label={label}
      title={label}
    >
      {isDark ? '☀️ Light' : '🌙 Dark'}
    </button>
  );
}

export default ThemeToggle;