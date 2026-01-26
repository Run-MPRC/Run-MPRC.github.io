import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';

/**
 * ObfuscatedEmail - Protects email from spam bots
 *
 * The email is split and encoded to prevent bot scraping.
 * It's only assembled when the user interacts with the component.
 */
function ObfuscatedEmail({
  user,
  domain,
  tld,
  className,
  children,
  showIcon,
}) {
  const [revealed, setRevealed] = useState(false);

  // Assemble email only on interaction
  const getEmail = useCallback(() => {
    return `${user}@${domain}.${tld}`;
  }, [user, domain, tld]);

  const handleClick = (e) => {
    e.preventDefault();
    const email = getEmail();
    window.location.href = `mailto:${email}`;
  };

  const handleReveal = () => {
    setRevealed(true);
  };

  // Display text - show encoded version until revealed
  const displayText = revealed ? getEmail() : `${user}[at]${domain}[dot]${tld}`;

  return (
    <a
      href="#contact"
      onClick={handleClick}
      onMouseEnter={handleReveal}
      onFocus={handleReveal}
      className={className}
      aria-label="Send us an email"
    >
      {children || (
        <>
          {showIcon && <span className="email-icon" aria-hidden="true" />}
          <span>{displayText}</span>
        </>
      )}
    </a>
  );
}

ObfuscatedEmail.propTypes = {
  user: PropTypes.string.isRequired,
  domain: PropTypes.string.isRequired,
  tld: PropTypes.string.isRequired,
  className: PropTypes.string,
  children: PropTypes.node,
  showIcon: PropTypes.bool,
};

ObfuscatedEmail.defaultProps = {
  className: '',
  children: null,
  showIcon: false,
};

export default ObfuscatedEmail;
