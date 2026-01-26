import React from 'react';
import PropTypes from 'prop-types';

function Paragraph({ children, className, style }) {
  return (
    <p className={`my-2 ${className || ''}`} style={style}>
      {children}
    </p>
  );
}

Paragraph.propTypes = {
  children: PropTypes.node.isRequired,
  className: PropTypes.string,
  style: PropTypes.object,
};

Paragraph.defaultProps = {
  className: '',
  style: {},
};

export default Paragraph;
