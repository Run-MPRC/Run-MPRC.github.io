import React from 'react';
import PropTypes from 'prop-types';

function ImageCarousel({ images, altTexts = [] }) {
  return (
    <div className="flex flex-col md:flex-row overflow-hidden my-4 w-full">
      {images.map((imageSrc, index) => (
        <div
          // eslint-disable-next-line react/no-array-index-key
          key={`carousel-${index}`} // Use a more descriptive key
          className="w-full aspect-w-16 aspect-h-9 overflow-hidden mb-4 md:mb-0"
        >
          <img
            src={imageSrc}
            className="object-cover object-center w-full h-64 md:mx-10"
            alt={altTexts[index] || `Activity image ${index + 1}`}
            loading="lazy"
          />
        </div>
      ))}
    </div>
  );
}

ImageCarousel.propTypes = {
  images: PropTypes.arrayOf(PropTypes.string).isRequired,
  altTexts: PropTypes.arrayOf(PropTypes.string),
};

export default ImageCarousel;
