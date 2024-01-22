import React from 'react';
import PropTypes from 'prop-types';

function Subheader({ title }) {
  return <h2 className="my-8">{title}</h2>;
}

Subheader.propTypes = {
  title: PropTypes.string.isRequired,
};

export default Subheader;
