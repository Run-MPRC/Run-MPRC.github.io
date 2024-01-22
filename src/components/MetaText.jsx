import React from 'react';
import PropTypes from 'prop-types';

function MetaText({ children }) {
  return <h5 className="my-4">{children}</h5>;
}

MetaText.propTypes = {
  children: PropTypes.node.isRequired,
};

export default MetaText;
