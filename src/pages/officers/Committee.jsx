import React from "react";
import Header from "../../components/Header";
import HeaderImage from "../../images/committee/header_bg_5.jpg";
import Officer from "../../components/Officer";
import "./committee.css";
import {COMMITTEE_INTRO, COMMITTEE_TITLE} from "../../text/Committee";

const OfficerDefault = require("../../images/committee/committee_default_portrait.png");
const Officer1 = require("../../images/committee/trainer1.jpg");
const Officer2 = require("../../images/committee/dave.png");
const Officer3 = require("../../images/committee/trainer3.jpg");
const Officer4 = require("../../images/committee/trainer4.jpg");
const Officer5 = require("../../images/committee/trainer5.jpg");
const Officer6 = require("../../images/committee/debbie.png");
const Officer7 = require("../../images/committee/patti.jpg")

const officers = [{
  id: 1, image: OfficerDefault, name: "Frances Schulze", job: "President", /* socials: [
      "https://instagram.com/",
      "https://twitter.com/",
      "https://facebook.com/",
      "https://linkedin.com/",
    ],*/
}, {
  id: 2, image: Officer2, name: "David Liu", job: "Vice President",
}, {
  id: 3, image: OfficerDefault, name: "Ted Levine", job: "Treasurer",
}, {
  id: 4, image: OfficerDefault, name: "Kat Mar", job: "Secretary",
}, {
  id: 5, image: OfficerDefault, name: "Frank Markowitz", job: "Newsletter Editor",
}, {
  id: 6, image: Officer6, name: "Debbie Mar", job: "Social Director",
}, {
  id: 7, image: Officer7, name: "Patti Chan", job: "Social Director",
},];

const Committee = () => {
  return (<>
      <Header image={HeaderImage} title={COMMITTEE_TITLE}>
        {COMMITTEE_INTRO}
      </Header>
      <section className="trainers">
        <div className="container trainers__container">
          {officers.map(({id, image, name, job, socials}) => {
            return (<Officer
                key={id}
                image={image}
                name={name}
                job={job}
                /*socials={[
                  { icon: <BsInstagram />, link: socials[0] },
                  { icon: <AiOutlineTwitter />, link: socials[1] },
                  { icon: <FaFacebookF />, link: socials[2] },
                  { icon: <FaLinkedinIn />, link: socials[3] },
                ]}*/
              />);
          })}
        </div>
      </section>
    </>);
};

export default Committee;
