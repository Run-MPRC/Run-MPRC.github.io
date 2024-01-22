import React from 'react';
import PropTypes from 'prop-types';

function Header({ title, image, children }) {
  return (
    <header className="header">
      <div className="header__container">
        <div className="header__container-lg">
          <img src={image} alt="Mid-Peninsula Running Club" />
        </div>
        <div className="header__content">
          <h2>{title}</h2>
          <p>{children}</p>
        </div>
      </div>
    </header>
  );
}

Header.propTypes = {
  title: PropTypes.string.isRequired,
  image: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
};

export default Header;
