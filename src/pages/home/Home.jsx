import React from "react";
import "./home.css";
import MainHeader from "../../components/MainHeader";
import Program from "../../components/Program";
import Values from "../../components/Values";
import FAQs from "../../components/FAQs";
import Testimonial from "../../components/Testimonial";
import Activities from "../activities/Activities";
// import Footer from "../../components/Footer";
import {
  HOME_WELCOME_MESSAGE_1,
  HOME_WELCOME_MESSAGE_2,
  HOME_WELCOME_MESSAGE_3,
  HOME_HERO_TEXT_1,
  HOME_HERO_TEXT_2,
  HOME_HERO_BUTTON_TEXT,
} from "../../text/Home";

const Home = () => {
  return (
    <>
      <div id="home hero-section" class="home hero-section main__header">
        <div id="hero-content" class="hero-content">
          <h1 id="hero-text-1" class="hero-text">
            {HOME_HERO_TEXT_1}
          </h1>
          <p id="hero-text-2" class="hero-text">
            {HOME_HERO_TEXT_2}
          </p>
          <a
            id="sign-up-button"
            class="sign-up-button btn lg"
            href="https://www.meetup.com/mid-peninsula-running-club/"
            target="_blank"
            rel="noopener noreferrer"
          >
            {HOME_HERO_BUTTON_TEXT}
          </a>
        </div>
      </div>
      <div id="paragraph-section" class="paragraph-section">
        <p id="welcome-message-1" class="welcome-message">
          {HOME_WELCOME_MESSAGE_1}
        </p>
        <p id="welcome-message-2" class="welcome-message">
          {HOME_WELCOME_MESSAGE_2}
        </p>
        <p id="welcome-message-3" class="welcome-message">
          {HOME_WELCOME_MESSAGE_3}
        </p>
      </div>
      <Activities />
      {/* <Program />
			<Values />
			<FAQs />
			<Testimonial /> */}
      {/* <Footer /> comment this out so footer wount be double */}
    </>
  );
};

export default Home;
