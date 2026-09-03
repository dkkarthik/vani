Feature: VANI 0.1 trustworthy scholarly workflow

  Background:
    Given a clean local VANI installation
    And the reference scholarly source fixtures are available

  @P0
  Scenario: Idea to grounded answer and bibliography
    When I create the collection "Terrain Representation"
    And I seed it with the idea "semantic geometric terrain abstractions for long-range navigation"
    And I accept two discovered works
    And I import a PDF for one accepted work
    And I annotate a passage in that PDF
    And I ask the collection "What is the innovation of this work over its closest alternative?"
    Then the answer cites exact evidence from the scoped collection
    And I can open each citation at its source location
    When I export the collection as BibTeX
    Then the BibTeX parses successfully
    And every exported key is unique

  @P0
  Scenario: CLEAR uses the canonical VANI citation key
    Given the publisher-deposited metadata for DOI "10.1109/LRA.2026.3726338"
    When VANI verifies the record
    Then the citation key is "meshram-ral26"
    And the venue is "IEEE Robotics and Automation Letters"
    And the volume is "11"
    And the issue is "10"
    And the pages are "11394-11401"

  @P0
  Scenario: Preprint and version of record remain distinct
    Given a verified arXiv preprint
    And a verified publisher version of the same conceptual work
    When VANI reconciles the records
    Then one conceptual work has two manifestations
    And each manifestation retains its own file and dates
    And each manifestation has a distinct citation key

  @P0
  Scenario: LLM output cannot verify a citation
    Given an LLM proposes a missing page range
    And no authoritative source asserts that page range
    When citation verification runs
    Then the proposed page range remains provisional
    And it is not exported as a verified field without user acknowledgement

  @P0
  Scenario: Annotation does not modify the original PDF
    Given a stored PDF with a known SHA-256 hash
    When I add and edit an annotation
    Then the stored original PDF hash is unchanged
    And the annotation can be exported in a separate annotated PDF

  @P0
  Scenario: Relationship evidence is inspectable
    Given VANI extracts that Paper A uses Paper B as a baseline
    When the relationship is displayed as verified
    Then it has an evidence span in Paper A
    And selecting the edge opens the experimental passage or table

  @P0
  Scenario: Formal review concerns retain status after acceptance
    Given a public OpenReview thread with an unresolved reviewer concern
    And the paper was accepted
    When VANI imports the decision
    Then the concern is not automatically marked resolved
    And the review, rebuttal, meta-review, and decision remain separately attributable

  @P0
  Scenario: Ask VANI attributes shortcomings
    Given a collection containing a paper, its reviews, and my notes
    When I ask "What are the key shortcomings of this work?"
    Then author-acknowledged limitations are labeled as such
    And reviewer-raised concerns are labeled as such
    And my assessments are labeled as user notes
    And model inferences are labeled as inferences

  @P0
  Scenario: Ask VANI refuses unsupported comparison
    Given the selected papers have no comparable runtime evaluation
    When I ask which paper is faster
    Then VANI states that the available evidence is insufficient
    And VANI does not cite merely topically related passages

  @P0
  Scenario: Private content is not sent remotely without authorization
    Given remote LLM use is configured for public metadata only
    And a question requires text from a private uploaded PDF
    When I ask the question
    Then the private PDF text is not sent to the remote provider
    And VANI explains the policy limitation or uses an authorized local model

  @P0
  Scenario: Complete restore preserves research state
    Given a library with collections, PDFs, annotations, notes, edges, and saved answers
    When I restore a verified backup into a clean installation
    Then all user artifacts and provenance are present
    And search indexes can be rebuilt from canonical data

