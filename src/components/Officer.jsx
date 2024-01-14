import React, { useState } from 'react';
import Card from "../UI/Card";

const Officer = ({ image, image_alt, name, job, socials }) => {
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
    >
      <div className="officer__img" >
        <img 
          // src={image}
          src={(isHovered && image_alt) ? image_alt : image}
          alt={name} 
        />
      </div>
      <h3>{name}</h3>
      <p>{job}</p>
      {/*<div className="officer__socials">
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
      </div>*/}
    </div>
  );
};

export default Officer;
