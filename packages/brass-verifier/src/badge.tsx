/**
 * BRASS "Protected by BRASS Proof" Badge Component
 * 
 * Embeddable React component and vanilla JS snippet for showing
 * BRASS protection status on your site (like reCAPTCHA badge).
 */

import React, { useState } from 'react'

export interface BadgeConfig {
  enabled: boolean
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  linkUrl?: string
  variant?: 'default' | 'minimal' | 'compact'
  theme?: 'light' | 'dark' | 'auto'
}

const DEFAULT_CONFIG: Required<BadgeConfig> = {
  enabled: true,
  position: 'bottom-right',
  linkUrl: 'https://brassproof.com',
  variant: 'default',
  theme: 'auto',
}

interface BrassBadgeProps extends Partial<BadgeConfig> {
  className?: string
}

export const BrassBadge: React.FC<BrassBadgeProps> = (props) => {
  const config = { ...DEFAULT_CONFIG, ...props }
  const [showTooltip, setShowTooltip] = useState(false)

  if (!config.enabled) {
    return null
  }

  const positionStyles: Record<string, React.CSSProperties> = {
    'bottom-right': { bottom: '16px', right: '16px' },
    'bottom-left': { bottom: '16px', left: '16px' },
    'top-right': { top: '16px', right: '16px' },
    'top-left': { top: '16px', left: '16px' },
  }

  const themeColors = {
    light: {
      bg: '#ffffff',
      text: '#374151',
      border: '#e5e7eb',
      link: '#2563eb',
    },
    dark: {
      bg: '#1f2937',
      text: '#f3f4f6',
      border: '#374151',
      link: '#60a5fa',
    },
  }

  const theme = config.theme === 'auto' 
    ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : config.theme

  const colors = themeColors[theme]

  const baseStyles: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    ...positionStyles[config.position],
  }

  const badgeStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: config.variant === 'compact' ? '6px 10px' : '8px 12px',
    backgroundColor: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: '6px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    fontSize: config.variant === 'compact' ? '11px' : '12px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: colors.text,
    textDecoration: 'none',
    transition: 'all 0.2s ease',
    cursor: 'pointer',
  }

  const tooltipStyles: React.CSSProperties = {
    position: 'absolute',
    bottom: '100%',
    right: 0,
    marginBottom: '8px',
    padding: '8px 12px',
    backgroundColor: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: '6px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    fontSize: '12px',
    whiteSpace: 'nowrap',
    opacity: showTooltip ? 1 : 0,
    pointerEvents: showTooltip ? 'auto' : 'none',
    transition: 'opacity 0.2s ease',
  }

  const ShieldIcon = () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )

  const content = (
    <>
      <ShieldIcon />
      {config.variant !== 'minimal' && (
        <span style={{ fontWeight: 500 }}>
          Protected by <span style={{ color: colors.link }}>BRASS Proof</span>
        </span>
      )}
    </>
  )

  return (
    <div style={baseStyles} className={props.className}>
      <a
        href={config.linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={badgeStyles}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        aria-label="Protected by BRASS Proof - Privacy-first abuse prevention"
      >
        {content}
      </a>
      <div style={tooltipStyles} role="tooltip">
        Privacy-first abuse prevention
        <br />
        <small style={{ opacity: 0.7 }}>No tracking • No user data collection</small>
      </div>
    </div>
  )
}

/**
 * Vanilla JavaScript snippet for non-React environments
 * 
 * Usage:
 * ```html
 * <script src="https://cdn.brassproof.com/badge.js"></script>
 * <script>
 *   BRASSBadge.init({
 *     position: 'bottom-right',
 *     variant: 'default',
 *     theme: 'auto'
 *   })
 * </script>
 * ```
 */
export const vanillaBadgeScript = `
(function() {
  window.BRASSBadge = {
    init: function(config) {
      config = config || {};
      if (config.enabled === false) return;
      
      const position = config.position || 'bottom-right';
      const variant = config.variant || 'default';
      const linkUrl = config.linkUrl || 'https://brassproof.com';
      const theme = config.theme || 'auto';
      
      const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const colors = isDark 
        ? { bg: '#1f2937', text: '#f3f4f6', border: '#374151', link: '#60a5fa' }
        : { bg: '#ffffff', text: '#374151', border: '#e5e7eb', link: '#2563eb' };
      
      const positions = {
        'bottom-right': 'bottom: 16px; right: 16px;',
        'bottom-left': 'bottom: 16px; left: 16px;',
        'top-right': 'top: 16px; right: 16px;',
        'top-left': 'top: 16px; left: 16px;'
      };
      
      const badge = document.createElement('div');
      badge.innerHTML = \`
        <a href="\${linkUrl}" 
           target="_blank" 
           rel="noopener noreferrer"
           style="
             display: flex;
             align-items: center;
             gap: 6px;
             padding: \${variant === 'compact' ? '6px 10px' : '8px 12px'};
             background: \${colors.bg};
             border: 1px solid \${colors.border};
             border-radius: 6px;
             box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
             font-size: \${variant === 'compact' ? '11px' : '12px'};
             font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
             color: \${colors.text};
             text-decoration: none;
             transition: all 0.2s ease;
           "
           aria-label="Protected by BRASS Proof - Privacy-first abuse prevention">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="M9 12l2 2 4-4"/>
          </svg>
          \${variant !== 'minimal' ? \`<span style="font-weight: 500">Protected by <span style="color: \${colors.link}">BRASS Proof</span></span>\` : ''}
        </a>
      \`;
      
      badge.style.cssText = \`
        position: fixed;
        z-index: 9999;
        \${positions[position]}
      \`;
      
      document.body.appendChild(badge);
    }
  };
})();
`;

export default BrassBadge
