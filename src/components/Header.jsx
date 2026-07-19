import React from 'react';
import PropTypes from 'prop-types';

function Header({ title, image, children }) {
  return (
    <header className="header">
      <div className="header__container">
        <div className="header__container-lg">
          <img src={image} alt="" aria-hidden="true" />
        </div>
        <div className="header__content">
          <h1>{title}</h1>
          {children && <p>{children}</p>}
        </div>
      </div>
    </header>
  );
}

Header.propTypes = {
  title: PropTypes.string.isRequired,
  image: PropTypes.string.isRequired,
  children: PropTypes.node,
};

export default Header;
