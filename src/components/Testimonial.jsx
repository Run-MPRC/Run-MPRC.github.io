import React, { useState } from 'react';
import { ImQuotesLeft } from 'react-icons/im';
import {
  IoIosArrowDropleftCircle,
  IoIosArrowDroprightCircle,
} from 'react-icons/io';
import SectionHead from './SectionHead';
import Card from '../UI/Card';
import { testimonials } from '../data';

// TODO: REMOVE
function Testimonial() {
  const [index, setIndex] = useState(0);
  const {
    name, quote, job, avatar,
  } = testimonials[index];

  const handlePreviousTestimonial = () => {
    setIndex((prevValue) => prevValue - 1);
    if (index <= 0) {
      setIndex(testimonials.length - 1);
    }
  };
  const handleAfterTestimonial = () => {
    setIndex((prevValue) => prevValue + 1);
    if (index >= testimonials.length - 1) {
      setIndex(0);
    }
  };

  return (
    <section className="testimonials">
      <div className="container testimonial__container">
        <SectionHead
          icon={<ImQuotesLeft />}
          title="Testimonials"
          className="testimonials__head"
        />
        <Card className="testimonial">
          <div className="testimonial__avatar">
            <img src={avatar} alt={name} />
          </div>
          <p className="testimonial__quote">{`"${quote}"`}</p>
          <h5>{name}</h5>
          <small className="testimonial__title">{job}</small>
        </Card>
        <div className="testimonial__btn-container">
          <button
            className="testimonials__btn"
            onClick={handlePreviousTestimonial}
          >
            <IoIosArrowDropleftCircle />
          </button>
          <button
            className="testimonials__btn"
            onClick={handleAfterTestimonial}
          >
            <IoIosArrowDroprightCircle />
          </button>
        </div>
      </div>
    </section>
  );
}

export default Testimonial;
