#pragma once

#include <juce_core/juce_core.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <array>
#include <vector>
#include <cmath>
#include <algorithm>

namespace braun
{

//==============================================================================
/**
 * @struct BraunColours
 * @brief Dieter Rams / Braun functionalist design color tokens for the AS-42.
 */
struct BraunColours
{
    enum ColourIds
    {
        bgAppColourId               = 0x4200100,
        bgPanelColourId             = 0x4200101,
        bgPanelInsetColourId        = 0x4200102,
        bgBezelColourId             = 0x4200103,
        borderLineColourId          = 0x4200104,
        borderSubtleColourId        = 0x4200105,
        textPrimaryColourId         = 0x4200106,
        textSecondaryColourId       = 0x4200107,
        textMutedColourId           = 0x4200108,
        knobCapLightId              = 0x4200109,
        knobCapDarkId               = 0x420010A,
        knobBorderColourId          = 0x420010B,
        knobIndicatorColourId       = 0x420010C,
        knobTrackColourId           = 0x420010D,
        knobFillColourId            = 0x420010E,
        braunOrangeColourId         = 0x420010F,
        braunGreenColourId          = 0x4200110,
        braunAmberColourId          = 0x4200111,
        phosphorColourId            = 0x4200112,
        phosphorGlowColourId        = 0x4200113
    };

    // Static Color Definitions: Light Chassis (Default)
    static constexpr uint32_t Light_BgApp          = 0xFFECEBE4;
    static constexpr uint32_t Light_BgPanel        = 0xFFE2E0D8;
    static constexpr uint32_t Light_BgPanelInset   = 0xFFD7D5CC;
    static constexpr uint32_t Light_BgBezel        = 0xFF121414;
    static constexpr uint32_t Light_BorderLine     = 0xFFCBC8BD;
    static constexpr uint32_t Light_BorderSubtle   = 0xFFD8D6CD;
    static constexpr uint32_t Light_TextPrimary    = 0xFF1C1D1E;
    static constexpr uint32_t Light_TextSecondary  = 0xFF5E6064;
    static constexpr uint32_t Light_TextMuted      = 0xFF8E9094;
    static constexpr uint32_t Light_KnobCapLight   = 0xFFE0DED7;
    static constexpr uint32_t Light_KnobCapDark    = 0xFFC8C5BB;
    static constexpr uint32_t Light_KnobBorder     = 0xFFBBB8AD;
    static constexpr uint32_t Light_KnobIndicator  = 0xFF1C1D1E;
    static constexpr uint32_t Light_KnobTrack      = 0xFFD0CEC4;
    static constexpr uint32_t Light_KnobFill       = 0xFF1C1D1E;

    // Static Color Definitions: Dark Chassis (Anthracite / Matte Black)
    static constexpr uint32_t Dark_BgApp           = 0xFF141517;
    static constexpr uint32_t Dark_BgPanel         = 0xFF1E2023;
    static constexpr uint32_t Dark_BgPanelInset    = 0xFF151618;
    static constexpr uint32_t Dark_BgBezel         = 0xFF0A0B0C;
    static constexpr uint32_t Dark_BorderLine      = 0xFF3A3A3A;
    static constexpr uint32_t Dark_BorderSubtle    = 0xFF2C2E33;
    static constexpr uint32_t Dark_TextPrimary     = 0xFFF0F0F0;
    static constexpr uint32_t Dark_TextSecondary   = 0xFFBDBDBD;
    static constexpr uint32_t Dark_TextMuted       = 0xFF8E8E8E;
    static constexpr uint32_t Dark_KnobCapLight    = 0xFF35373C;
    static constexpr uint32_t Dark_KnobCapDark     = 0xFF232428;
    static constexpr uint32_t Dark_KnobBorder      = 0xFF4A4D52;
    static constexpr uint32_t Dark_KnobIndicator   = 0xFFF0F0F0;
    static constexpr uint32_t Dark_KnobTrack       = 0xFF2A2C30;
    static constexpr uint32_t Dark_KnobFill        = 0xFFEE592B; // Signature orange in dark mode

    // Signature Accent Colors (Shared)
    static constexpr uint32_t Accent_BraunOrange   = 0xFFEE592B;
    static constexpr uint32_t Accent_BraunGreen    = 0xFF24FF6A;
    static constexpr uint32_t Accent_BraunAmber    = 0xFFE5A93C;
    static constexpr uint32_t PhosphorGreen        = 0xFF24FF6A;
};

//==============================================================================
/**
 * @class BraunLookAndFeel
 * @brief Custom JUCE 8 LookAndFeel implementing Dieter Rams functionalist UI for the AS-42.
 */
class BraunLookAndFeel : public juce::LookAndFeel_V4
{
public:
    BraunLookAndFeel()
    {
        applyThemeColours();
    }

    ~BraunLookAndFeel() override = default;

    void setDarkTheme(bool useDarkTheme)
    {
        if (darkThemeActive != useDarkTheme)
        {
            darkThemeActive = useDarkTheme;
            applyThemeColours();
        }
    }

    bool isDarkTheme() const noexcept { return darkThemeActive; }

    enum class KnobTier
    {
        Trim,       // 42px small knob
        Secondary,  // 52px medium knob
        Hero        // 64px large knob
    };

    static KnobTier getKnobTierForBounds(int width, int height) noexcept
    {
        const int minDim = juce::jmin(width, height);
        if (minDim >= 60) return KnobTier::Hero;
        if (minDim >= 48) return KnobTier::Secondary;
        return KnobTier::Trim;
    }

    void drawRotarySlider(juce::Graphics& g, int x, int y, int width, int height,
                          float sliderPosProportional, float rotaryStartAngle,
                          float rotaryEndAngle, juce::Slider& slider) override
    {
        auto bounds = juce::Rectangle<int>(x, y, width, height).toFloat().reduced(2.0f);
        auto center = bounds.getCentre();
        auto diameter = juce::jmin(bounds.getWidth(), bounds.getHeight());
        auto radius = diameter / 2.0f;

        const auto tier = getKnobTierForBounds(width, height);
        float trackStrokeWidth = (tier == KnobTier::Hero) ? 4.5f : (tier == KnobTier::Secondary) ? 4.0f : 3.0f;
        float capMargin = (tier == KnobTier::Hero) ? 9.0f : (tier == KnobTier::Secondary) ? 8.0f : 6.5f;

        auto trackRadius = radius - (trackStrokeWidth * 0.5f) - 1.0f;
        if (trackRadius <= 0.0f) return;

        auto currentAngle = rotaryStartAngle + sliderPosProportional * (rotaryEndAngle - rotaryStartAngle);

        // 1. Quiescent Background Track Arc
        juce::Path trackPath;
        trackPath.addCentredArc(center.x, center.y, trackRadius, trackRadius,
                                0.0f, rotaryStartAngle, rotaryEndAngle, true);
        g.setColour(findColour(BraunColours::knobTrackColourId));
        g.strokePath(trackPath, juce::PathStrokeType(trackStrokeWidth,
                                                     juce::PathStrokeType::curved,
                                                     juce::PathStrokeType::rounded));

        // 2. Active Parameter Fill Arc
        if (sliderPosProportional > 0.001f)
        {
            juce::Path fillPath;
            fillPath.addCentredArc(center.x, center.y, trackRadius, trackRadius,
                                   0.0f, rotaryStartAngle, currentAngle, true);

            auto fillColour = slider.isMouseOverOrDragging()
                                ? findColour(BraunColours::braunOrangeColourId)
                                : findColour(BraunColours::knobFillColourId);

            g.setColour(fillColour);
            g.strokePath(fillPath, juce::PathStrokeType(trackStrokeWidth,
                                                        juce::PathStrokeType::curved,
                                                        juce::PathStrokeType::rounded));
        }

        // 3. Precision Turned Aluminum Cap
        auto capRadius = radius - capMargin;
        if (capRadius <= 2.0f) return;

        auto capBounds = juce::Rectangle<float>(center.x - capRadius, center.y - capRadius,
                                                capRadius * 2.0f, capRadius * 2.0f);

        // Subtle drop shadow under cap
        g.setColour(juce::Colours::black.withAlpha(darkThemeActive ? 0.35f : 0.12f));
        g.fillEllipse(capBounds.translated(0.0f, 2.0f));

        // Concentric machined aluminum radial gradient
        juce::ColourGradient capGradient(
            findColour(BraunColours::knobCapLightId), center.x - capRadius * 0.35f, center.y - capRadius * 0.35f,
            findColour(BraunColours::knobCapDarkId),  center.x + capRadius * 0.35f, center.y + capRadius * 0.35f,
            true);
        g.setGradientFill(capGradient);
        g.fillEllipse(capBounds);

        // Subtle concentric knurling grooves
        if (tier != KnobTier::Trim)
        {
            g.setColour(findColour(BraunColours::knobBorderColourId).withAlpha(0.35f));
            g.drawEllipse(capBounds.reduced(capRadius * 0.28f), 0.75f);
            g.drawEllipse(capBounds.reduced(capRadius * 0.52f), 0.75f);
        }

        // Machined perimeter bezel rim
        g.setColour(findColour(BraunColours::knobBorderColourId));
        g.drawEllipse(capBounds, 1.0f);

        // Top specular highlight bevel
        juce::Path highlightBevel;
        highlightBevel.addCentredArc(center.x, center.y, capRadius - 0.5f, capRadius - 0.5f,
                                     0.0f, -juce::MathConstants<float>::pi * 0.75f,
                                     juce::MathConstants<float>::pi * 0.25f, true);
        g.setColour(juce::Colours::white.withAlpha(darkThemeActive ? 0.10f : 0.40f));
        g.strokePath(highlightBevel, juce::PathStrokeType(0.8f));

        // 4. Milled Indicator Notch
        float notchLength = (tier == KnobTier::Hero) ? 10.0f : (tier == KnobTier::Secondary) ? 8.0f : 6.0f;
        float notchWidth = (tier == KnobTier::Hero) ? 2.2f : 1.8f;
        float notchStart = 3.0f;

        juce::Path notch;
        notch.startNewSubPath(center.x, center.y - capRadius + notchStart);
        notch.lineTo(center.x, center.y - capRadius + notchStart + notchLength);

        auto indicatorColour = slider.isMouseOverOrDragging()
                                 ? findColour(BraunColours::braunOrangeColourId)
                                 : findColour(BraunColours::knobIndicatorColourId);

        g.setColour(indicatorColour);
        g.strokePath(notch,
                     juce::PathStrokeType(notchWidth, juce::PathStrokeType::curved, juce::PathStrokeType::rounded),
                     juce::AffineTransform::rotation(currentAngle, center.x, center.y));
    }

    void drawToggleButton(juce::Graphics& g, juce::ToggleButton& button,
                          bool shouldDrawButtonAsHighlighted, bool shouldDrawButtonAsDown) override
    {
        auto bounds = button.getLocalBounds().toFloat();
        float tickSize = juce::jmin(bounds.getHeight() - 4.0f, 18.0f);
        float tickX = bounds.getX() + 2.0f;
        float tickY = bounds.getCentreY() - (tickSize * 0.5f);

        drawTickBox(g, button, tickX, tickY, tickSize, tickSize,
                    button.getToggleState(), button.isEnabled(),
                    shouldDrawButtonAsHighlighted, shouldDrawButtonAsDown);

        auto textBounds = bounds.withTrimmedLeft(tickX + tickSize + 6.0f);
        g.setColour(findColour(BraunColours::textPrimaryColourId));
        g.setFont(juce::Font(juce::FontOptions(10.0f, juce::Font::bold)));
        g.drawFittedText(button.getButtonText(), textBounds.toNearestInt(),
                         juce::Justification::centredLeft, 1);
    }

    void drawTickBox(juce::Graphics& g, juce::Component&,
                     float x, float y, float w, float h,
                     bool ticked, bool isEnabled,
                     bool shouldDrawButtonAsHighlighted, bool shouldDrawButtonAsDown) override
    {
        juce::ignoreUnused(isEnabled, shouldDrawButtonAsHighlighted, shouldDrawButtonAsDown);

        auto box = juce::Rectangle<float>(x, y, w, h);

        g.setColour(findColour(BraunColours::bgPanelInsetColourId));
        g.fillRoundedRectangle(box, 3.0f);

        g.setColour(findColour(BraunColours::borderLineColourId));
        g.drawRoundedRectangle(box, 3.0f, 1.0f);

        float ledRadius = juce::jmin(w, h) * 0.28f;
        auto ledCenter = box.getCentre();
        auto ledBounds = juce::Rectangle<float>(ledCenter.x - ledRadius, ledCenter.y - ledRadius,
                                                ledRadius * 2.0f, ledRadius * 2.0f);

        if (ticked)
        {
            auto glowColour = findColour(BraunColours::braunOrangeColourId).withAlpha(0.45f);
            g.setColour(glowColour);
            g.fillEllipse(ledBounds.expanded(3.0f));

            g.setColour(findColour(BraunColours::braunOrangeColourId));
            g.fillEllipse(ledBounds);

            g.setColour(juce::Colours::white.withAlpha(0.6f));
            g.fillEllipse(ledBounds.reduced(ledRadius * 0.45f).translated(-0.5f, -0.5f));
        }
        else
        {
            g.setColour(findColour(BraunColours::borderLineColourId));
            g.fillEllipse(ledBounds);

            g.setColour(juce::Colours::black.withAlpha(0.35f));
            g.drawEllipse(ledBounds, 0.75f);
        }
    }

    void drawButtonBackground(juce::Graphics& g, juce::Button& button,
                              const juce::Colour& backgroundColour,
                              bool shouldDrawButtonAsHighlighted, bool shouldDrawButtonAsDown) override
    {
        juce::ignoreUnused(backgroundColour);

        auto bounds = button.getLocalBounds().toFloat();
        const float cornerRadius = 3.0f;

        bool isActive = button.getToggleState() || shouldDrawButtonAsDown;

        if (isActive)
        {
            g.setColour(findColour(BraunColours::braunOrangeColourId));
            g.fillRoundedRectangle(bounds, cornerRadius);

            g.setColour(findColour(BraunColours::borderLineColourId));
            g.drawRoundedRectangle(bounds, cornerRadius, 1.0f);
        }
        else
        {
            auto fill = shouldDrawButtonAsHighlighted
                            ? findColour(BraunColours::bgPanelInsetColourId).brighter(0.05f)
                            : findColour(BraunColours::bgPanelInsetColourId);

            g.setColour(fill);
            g.fillRoundedRectangle(bounds, cornerRadius);

            g.setColour(findColour(BraunColours::borderLineColourId));
            g.drawRoundedRectangle(bounds, cornerRadius, 1.0f);
        }
    }

    void drawButtonText(juce::Graphics& g, juce::TextButton& button,
                        bool shouldDrawButtonAsHighlighted, bool shouldDrawButtonAsDown) override
    {
        juce::ignoreUnused(shouldDrawButtonAsHighlighted);

        bool isActive = button.getToggleState() || shouldDrawButtonAsDown;
        auto textColour = isActive ? juce::Colours::white : findColour(BraunColours::textPrimaryColourId);

        g.setColour(textColour);
        g.setFont(getTextButtonFont(button, button.getHeight()));
        g.drawFittedText(button.getButtonText(), button.getLocalBounds(),
                         juce::Justification::centred, 1);
    }

    void drawLabel(juce::Graphics& g, juce::Label& label) override
    {
        g.fillAll(label.findColour(juce::Label::backgroundColourId));

        if (!label.isBeingEdited())
        {
            auto alpha = label.isEnabled() ? 1.0f : 0.5f;
            auto font = getLabelFont(label);
            auto textColour = label.findColour(juce::Label::textColourId);

            if (auto* box = dynamic_cast<juce::ComboBox*>(label.getParentComponent()))
            {
                textColour = box->findColour(juce::ComboBox::textColourId);
                font = getComboBoxFont(*box);
            }

            g.setColour(textColour.withMultipliedAlpha(alpha));
            g.setFont(font);

            auto textArea = getLabelBorderSize(label).subtractedFrom(label.getLocalBounds());
            g.drawFittedText(label.getText(), textArea, label.getJustificationType(),
                             juce::jmax(1, (int)((float)textArea.getHeight() / font.getHeight())),
                             label.getMinimumHorizontalScale());
        }
    }

    juce::Font getTextButtonFont(juce::TextButton&, int buttonHeight) override
    {
        return juce::Font(juce::FontOptions(juce::jmin(11.0f, (float)buttonHeight * 0.55f),
                                            juce::Font::bold));
    }

    juce::Font getLabelFont(juce::Label&) override
    {
        return juce::Font(juce::FontOptions(10.0f, juce::Font::bold));
    }

    void drawComboBox(juce::Graphics& g, int width, int height, bool isButtonDown,
                      int buttonX, int buttonY, int buttonW, int buttonH,
                      juce::ComboBox& box) override
    {
        juce::ignoreUnused(buttonX, buttonY, buttonW, buttonH);
        auto bounds = juce::Rectangle<float>(0, 0, (float)width, (float)height).reduced(1.0f);

        auto bgColour = findColour(juce::ComboBox::backgroundColourId);
        if (isButtonDown || box.isPopupActive())
            bgColour = bgColour.brighter(0.08f);
        g.setColour(bgColour);
        g.fillRoundedRectangle(bounds, 2.0f);

        auto borderColour = box.hasKeyboardFocus(true) ? findColour(BraunColours::braunOrangeColourId)
                                                       : findColour(juce::ComboBox::outlineColourId);
        g.setColour(borderColour);
        g.drawRoundedRectangle(bounds, 2.0f, 1.0f);

        auto arrowZone = juce::Rectangle<float>((float)width - 18.0f, 0.0f, 14.0f, (float)height);
        juce::Path arrow;
        float arrowW = 6.0f;
        float arrowH = 3.5f;
        float cx = arrowZone.getCentreX();
        float cy = arrowZone.getCentreY();
        arrow.startNewSubPath(cx - arrowW * 0.5f, cy - arrowH * 0.5f);
        arrow.lineTo(cx, cy + arrowH * 0.5f);
        arrow.lineTo(cx + arrowW * 0.5f, cy - arrowH * 0.5f);

        g.setColour(findColour(juce::ComboBox::arrowColourId));
        g.strokePath(arrow, juce::PathStrokeType(1.5f, juce::PathStrokeType::mitered, juce::PathStrokeType::rounded));
    }

    juce::Font getComboBoxFont(juce::ComboBox&) override
    {
        return juce::Font(juce::FontOptions(10.0f, juce::Font::bold));
    }

    juce::Font getPopupMenuFont() override
    {
        return juce::Font(juce::FontOptions(11.0f, juce::Font::plain));
    }

    void drawPopupMenuBackground(juce::Graphics& g, int width, int height) override
    {
        g.fillAll(findColour(juce::PopupMenu::backgroundColourId));
        g.setColour(findColour(BraunColours::borderLineColourId));
        g.drawRect(0, 0, width, height, 1);
    }

private:
    bool darkThemeActive { false };

    void applyThemeColours()
    {
        if (darkThemeActive)
        {
            setColour(BraunColours::bgAppColourId,          juce::Colour(BraunColours::Dark_BgApp));
            setColour(BraunColours::bgPanelColourId,        juce::Colour(BraunColours::Dark_BgPanel));
            setColour(BraunColours::bgPanelInsetColourId,   juce::Colour(BraunColours::Dark_BgPanelInset));
            setColour(BraunColours::bgBezelColourId,        juce::Colour(BraunColours::Dark_BgBezel));
            setColour(BraunColours::borderLineColourId,     juce::Colour(BraunColours::Dark_BorderLine));
            setColour(BraunColours::borderSubtleColourId,   juce::Colour(BraunColours::Dark_BorderSubtle));
            setColour(BraunColours::textPrimaryColourId,    juce::Colour(BraunColours::Dark_TextPrimary));
            setColour(BraunColours::textSecondaryColourId,  juce::Colour(BraunColours::Dark_TextSecondary));
            setColour(BraunColours::textMutedColourId,      juce::Colour(BraunColours::Dark_TextMuted));
            setColour(BraunColours::knobCapLightId,         juce::Colour(BraunColours::Dark_KnobCapLight));
            setColour(BraunColours::knobCapDarkId,          juce::Colour(BraunColours::Dark_KnobCapDark));
            setColour(BraunColours::knobBorderColourId,     juce::Colour(BraunColours::Dark_KnobBorder));
            setColour(BraunColours::knobIndicatorColourId,  juce::Colour(BraunColours::Dark_KnobIndicator));
            setColour(BraunColours::knobTrackColourId,      juce::Colour(BraunColours::Dark_KnobTrack));
            setColour(BraunColours::knobFillColourId,       juce::Colour(BraunColours::Dark_KnobFill));

            setColour(juce::ResizableWindow::backgroundColourId, juce::Colour(BraunColours::Dark_BgApp));
            setColour(juce::Label::textColourId,                 juce::Colour(BraunColours::Dark_TextPrimary));
            setColour(juce::TextButton::buttonColourId,          juce::Colour(BraunColours::Dark_BgPanelInset));
            setColour(juce::TextButton::buttonOnColourId,        juce::Colour(BraunColours::Accent_BraunOrange));
            setColour(juce::TextButton::textColourOffId,         juce::Colour(BraunColours::Dark_TextPrimary));
            setColour(juce::TextButton::textColourOnId,          juce::Colours::white);

            setColour(juce::ComboBox::backgroundColourId,        juce::Colour(BraunColours::Dark_BgPanelInset));
            setColour(juce::ComboBox::textColourId,              juce::Colour(BraunColours::Dark_TextPrimary));
            setColour(juce::ComboBox::outlineColourId,           juce::Colour(BraunColours::Dark_BorderLine));
            setColour(juce::ComboBox::arrowColourId,             juce::Colour(BraunColours::Dark_TextSecondary));
            setColour(juce::ComboBox::focusedOutlineColourId,    juce::Colour(BraunColours::Accent_BraunOrange));

            setColour(juce::PopupMenu::backgroundColourId,            juce::Colour(BraunColours::Dark_BgPanel));
            setColour(juce::PopupMenu::textColourId,                  juce::Colour(BraunColours::Dark_TextPrimary));
            setColour(juce::PopupMenu::headerTextColourId,            juce::Colour(BraunColours::Accent_BraunOrange));
            setColour(juce::PopupMenu::highlightedBackgroundColourId, juce::Colour(BraunColours::Dark_BgPanelInset));
            setColour(juce::PopupMenu::highlightedTextColourId,       juce::Colour(BraunColours::Accent_BraunOrange));
        }
        else
        {
            setColour(BraunColours::bgAppColourId,          juce::Colour(BraunColours::Light_BgApp));
            setColour(BraunColours::bgPanelColourId,        juce::Colour(BraunColours::Light_BgPanel));
            setColour(BraunColours::bgPanelInsetColourId,   juce::Colour(BraunColours::Light_BgPanelInset));
            setColour(BraunColours::bgBezelColourId,        juce::Colour(BraunColours::Light_BgBezel));
            setColour(BraunColours::borderLineColourId,     juce::Colour(BraunColours::Light_BorderLine));
            setColour(BraunColours::borderSubtleColourId,   juce::Colour(BraunColours::Light_BorderSubtle));
            setColour(BraunColours::textPrimaryColourId,    juce::Colour(BraunColours::Light_TextPrimary));
            setColour(BraunColours::textSecondaryColourId,  juce::Colour(BraunColours::Light_TextSecondary));
            setColour(BraunColours::textMutedColourId,      juce::Colour(BraunColours::Light_TextMuted));
            setColour(BraunColours::knobCapLightId,         juce::Colour(BraunColours::Light_KnobCapLight));
            setColour(BraunColours::knobCapDarkId,          juce::Colour(BraunColours::Light_KnobCapDark));
            setColour(BraunColours::knobBorderColourId,     juce::Colour(BraunColours::Light_KnobBorder));
            setColour(BraunColours::knobIndicatorColourId,  juce::Colour(BraunColours::Light_KnobIndicator));
            setColour(BraunColours::knobTrackColourId,      juce::Colour(BraunColours::Light_KnobTrack));
            setColour(BraunColours::knobFillColourId,       juce::Colour(BraunColours::Light_KnobFill));

            setColour(juce::ResizableWindow::backgroundColourId, juce::Colour(BraunColours::Light_BgApp));
            setColour(juce::Label::textColourId,                 juce::Colour(BraunColours::Light_TextPrimary));
            setColour(juce::TextButton::buttonColourId,          juce::Colour(BraunColours::Light_BgPanelInset));
            setColour(juce::TextButton::buttonOnColourId,        juce::Colour(BraunColours::Accent_BraunOrange));
            setColour(juce::TextButton::textColourOffId,         juce::Colour(BraunColours::Light_TextPrimary));
            setColour(juce::TextButton::textColourOnId,          juce::Colours::white);

            setColour(juce::ComboBox::backgroundColourId,        juce::Colour(BraunColours::Light_BgPanelInset));
            setColour(juce::ComboBox::textColourId,              juce::Colour(BraunColours::Light_TextPrimary));
            setColour(juce::ComboBox::outlineColourId,           juce::Colour(BraunColours::Light_BorderLine));
            setColour(juce::ComboBox::arrowColourId,             juce::Colour(BraunColours::Light_TextSecondary));
            setColour(juce::ComboBox::focusedOutlineColourId,    juce::Colour(BraunColours::Accent_BraunOrange));

            setColour(juce::PopupMenu::backgroundColourId,            juce::Colour(BraunColours::Light_BgPanel));
            setColour(juce::PopupMenu::textColourId,                  juce::Colour(BraunColours::Light_TextPrimary));
            setColour(juce::PopupMenu::headerTextColourId,            juce::Colour(BraunColours::Accent_BraunOrange));
            setColour(juce::PopupMenu::highlightedBackgroundColourId, juce::Colour(BraunColours::Light_BgPanelInset));
            setColour(juce::PopupMenu::highlightedTextColourId,       juce::Colour(BraunColours::Accent_BraunOrange));
        }

        setColour(BraunColours::braunOrangeColourId,  juce::Colour(BraunColours::Accent_BraunOrange));
        setColour(BraunColours::braunGreenColourId,   juce::Colour(BraunColours::Accent_BraunGreen));
        setColour(BraunColours::braunAmberColourId,   juce::Colour(BraunColours::Accent_BraunAmber));
        setColour(BraunColours::phosphorColourId,     juce::Colour(BraunColours::PhosphorGreen));
        setColour(BraunColours::phosphorGlowColourId, juce::Colour(BraunColours::PhosphorGreen).withAlpha(0.40f));
    }

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BraunLookAndFeel)
};

} // namespace braun
