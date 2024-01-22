import React from 'react';
import PropTypes from 'prop-types';

function FlexColumnContainer({ children }) {
  return (
    <div className="container mx-auto md flex flex-col items-center">
      {children}
    </div>
  );
}

FlexColumnContainer.propTypes = {
  children: PropTypes.node.isRequired,
};

export default FlexColumnContainer;
