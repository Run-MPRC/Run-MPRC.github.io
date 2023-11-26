import React from 'react';
import { Container, Row, Col, Image } from 'react-bootstrap';

const Home = () => {
  return (
    <Container>
      <Row className="my-4">
        <Col md={6} className="text-center">
          <Image src="path-to-your-image.jpg" alt="Running Club" fluid />
        </Col>
        <Col md={6}>
          <h2>The Mid-Peninsula Running Club (MPRC)</h2>
          <p>Established in 1988, serving runners in the San Mateo County area. We welcome new & experienced runners and walkers of various speeds. Runs every Saturday morning on the Bay Trail in San Mateo.</p>
        </Col>
      </Row>
    </Container>
  );
}

export default Home;
