import React, { useState } from 'react';
import PropTypes from 'prop-types';

function Officer({
  image, imageAlt, name, job, /* socials, */
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
      {/* <div className="officer__socials">
        {socials.map(({ icon, link }, index) => {
          return (
            <a
              href={link}
              key={index}
              target="_blank"
              rel="noreferrer noopener"
            >
              {icon}
            </a>
          );
        })}
      </div> */}
    </div>
  );
}

Officer.propTypes = {
  image: PropTypes.string.isRequired,
  imageAlt: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  job: PropTypes.string.isRequired,
  /* socials: PropTypes.arrayOf(
    PropTypes.shape({
      icon: PropTypes.node.isRequired,
      link: PropTypes.string.isRequired,
    }),
  ), */
};
export default Officer;
