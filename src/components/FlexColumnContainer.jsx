import React from 'react';
import PropTypes from 'prop-types';

function FlexColumnContainer({ children, className, style }) {
  return (
    <div
      className={`container mx-auto md flex flex-col items-center ${className || ''}`}
      style={style}
    >
      {children}
    </div>
  );
}

FlexColumnContainer.propTypes = {
  children: PropTypes.node.isRequired,
  className: PropTypes.string,
  style: PropTypes.object,
};

export default FlexColumnContainer;
