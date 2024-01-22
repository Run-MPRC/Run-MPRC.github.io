import React from 'react';
import PropTypes from 'prop-types';

function Paragraph({ children }) {
  return <p className="my-2">{children}</p>;
}

Paragraph.propTypes = {
  children: PropTypes.node.isRequired,
};

export default Paragraph;
