import React, { useState } from 'react';
import PropTypes from 'prop-types';

function Officer({
  image, imageAlt, name, job,
}) {
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseOver = () => {
    setIsHovered(true);
  };

  const handleMouseOut = () => {
    setIsHovered(false);
  };

  return (
    <div
      className="card officer"
      onMouseOver={handleMouseOver}
      onMouseOut={handleMouseOut}
      onFocus={handleMouseOver}
      onBlur={handleMouseOut}
    >
      <div className="officer__img">
        <img
          src={isHovered && imageAlt ? imageAlt : image}
          alt={name}
        />
      </div>
      <h3>{name}</h3>
      <p>{job}</p>
    </div>
  );
}

Officer.propTypes = {
  image: PropTypes.string.isRequired,
  imageAlt: PropTypes.string,
  name: PropTypes.string.isRequired,
  job: PropTypes.string.isRequired,
};

Officer.defaultProps = {
  imageAlt: null,
};

export default Officer;
