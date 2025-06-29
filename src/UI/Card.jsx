import React from 'react';
import PropTypes from 'prop-types';

function Card({ className, children }) {
  return <article className={`card ${className || ''}`}>{children}</article>;
}

Card.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node.isRequired, // Example: You can adjust this based on your use case
};

Card.defaultProps = {
  className: '',
};

export default Card;
